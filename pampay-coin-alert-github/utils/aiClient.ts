/**
 * aiClient — Rork-independent replacement for `@rork-ai/toolkit-sdk` generateObject().
 *
 * Resolution order:
 *  1) Scanner-server proxy  →  POST {serverUrl}/ai/generate (server holds OPENAI_API_KEY)
 *  2) Direct OpenAI-compatible endpoint (EXPO_PUBLIC_OPENAI_API_KEY [+ BASE_URL])
 *  3) Local heuristic fallback (no LLM) — parses the prompt's own market stats so the
 *     app still produces a usable signal outline when fully offline.
 *
 * The returned object is validated against the caller's zod schema in every mode.
 */
import { z } from 'zod';
import { getServerUrl } from './scanServerApi';

type ChatMessage = { role: 'user' | 'system' | 'assistant'; content: string };

interface GenerateObjectParams<S extends z.ZodTypeAny> {
  messages: ChatMessage[];
  schema: S;
}

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const OPENAI_BASE = process.env.EXPO_PUBLIC_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o-mini';

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function viaServerProxy(messages: ChatMessage[]): Promise<unknown | null> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return null;
  try {
    const res = await fetch(`${serverUrl}/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; object?: unknown };
    return data && data.ok && data.object ? data.object : null;
  } catch (e) {
    console.log('[AI] server proxy failed:', e);
    return null;
  }
}

async function viaOpenAI(messages: ChatMessage[]): Promise<unknown | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content ?? '';
    return extractJson(content);
  } catch (e) {
    console.log('[AI] openai direct failed:', e);
    return null;
  }
}

/**
 * Offline heuristic: the prompt already embeds symbol, price, bullish/bearish
 * counts and confluence score. Derive a conservative signal from them.
 */
function localFallback(messages: ChatMessage[]): unknown {
  const prompt = messages.map((m) => m.content).join('\n');
  const priceMatch = prompt.match(/Current Price:\s*\$?([\d.,]+)/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
  const bullMatch = prompt.match(/Bullish signals:\s*(\d+)\s*\/\s*(\d+)/);
  const bearMatch = prompt.match(/Bearish signals:\s*(\d+)\s*\/\s*(\d+)/);
  const confMatch = prompt.match(/confluence score[:\s]*(\d+)/i);
  const levMatch = prompt.match(/Max Leverage:\s*(\d+)x/);
  const slMatch = prompt.match(/Stop Loss:\s*(\d+)%/);

  const bull = bullMatch ? parseInt(bullMatch[1], 10) : 0;
  const total = bullMatch ? parseInt(bullMatch[2], 10) : 1;
  const bear = bearMatch ? parseInt(bearMatch[1], 10) : 0;
  const confluence = confMatch ? parseInt(confMatch[1], 10) : Math.round((bull / Math.max(total, 1)) * 100);

  const action = confluence >= 70 ? (bull >= bear ? 'buy' : 'sell') : 'hold';
  const confidence = Math.min(95, Math.max(35, confluence));
  const entry = price || 0;
  const slPct = slMatch ? parseInt(slMatch[1], 10) : 2;
  const targetPct = slPct * 2;

  return {
    action,
    confidence,
    entryPrice: entry,
    targetPrice: action === 'sell' ? entry * (1 - targetPct / 100) : entry * (1 + targetPct / 100),
    stopLoss: action === 'sell' ? entry * (1 + slPct / 100) : entry * (1 - slPct / 100),
    leverage: levMatch ? Math.min(parseInt(levMatch[1], 10), 5) : 3,
    timeframe: '4h',
    reasoning:
      `تحلیل محلی (بدون اتصال به هوش مصنوعی): امتیاز Confluence محاسبه‌شده ${confluence} است ` +
      `(${bull} سیگنال صعودی در برابر ${bear} سیگنال نزولی از ${total} اندیکاتور). ` +
      (action === 'hold'
        ? 'به دلیل اطمینان پایین، ورود توصیه نمی‌شود.'
        : 'سیگنال بر اساس اکثریت اندیکاتورها صادر شده است؛ حد ضرر و هدف به صورت خودکار تنظیم شد.'),
  };
}

export async function generateObject<S extends z.ZodTypeAny>({
  messages,
  schema,
}: GenerateObjectParams<S>): Promise<z.infer<S>> {
  let candidate = await viaServerProxy(messages);
  if (candidate === null) candidate = await viaOpenAI(messages);
  if (candidate === null) candidate = localFallback(messages);

  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data as z.infer<S>;

  // Schema mismatch (e.g. heuristic shape) — last chance: local fallback validated.
  const fallbackParsed = schema.safeParse(localFallback(messages));
  if (fallbackParsed.success) return fallbackParsed.data as z.infer<S>;

  throw new Error('[AI] generateObject: no valid object produced');
}
