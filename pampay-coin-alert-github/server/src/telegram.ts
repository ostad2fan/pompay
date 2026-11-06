// server/src/telegram.ts
// Shared Telegram sender for the scan modules. Splits long texts into
// multiple messages (Telegram hard limit: 4096 chars per message) so ALL
// signals are announced — no more 10-signal caps.

import store from "./store";

export interface TelegramTarget {
  botToken: string;
  chatId: string;
}

const MAX_LEN = 3800;

// v1.4.4 — remember the LAST send outcome so /scan/status and /bot/test can
// explain WHY Telegram messages might not be arriving (revoked token, wrong
// chat id, network hiccup). Null = every send so far succeeded. Persisted in
// the store so a restart doesn't lose the diagnosis.
let lastTelegramError: { at: number; error: string } | null = null;

export async function getLastTelegramError(): Promise<{ at: number; error: string } | null> {
  if (lastTelegramError) return lastTelegramError;
  try {
    return await store.get<{ at: number; error: string }>("lastTelegramError");
  } catch {
    return null;
  }
}

export function splitTelegramText(text: string, limit: number = MAX_LEN): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }
    if ((current + "\n" + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sends one logical Telegram message (auto-split into several physical
 * messages when it exceeds the length limit). Never throws.
 */
export async function sendTelegram(
  target: TelegramTarget,
  text: string
): Promise<boolean> {
  if (!target.botToken || !target.chatId) return false;
  const chunks = splitTelegramText(text);
  let allOk = true;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${target.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: target.chatId,
            text: chunks[i],
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastTelegramError = { at: Date.now(), error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        void store.put("lastTelegramError", lastTelegramError);
        console.log(
          `[Telegram] send failed (${res.status}) part ${i + 1}/${chunks.length}: ${body.slice(0, 200)}`
        );
        allOk = false;
      }
      if (i > 0) await sleep(400); // stay under the bot rate limit
    } catch (e) {
      lastTelegramError = { at: Date.now(), error: String(e).slice(0, 200) };
      void store.put("lastTelegramError", lastTelegramError);
      console.log("[Telegram] send error:", e);
      allOk = false;
    }
  }
  if (allOk) {
    lastTelegramError = null;
    void store.put("lastTelegramError", null);
    void store.put("lastTelegramSuccessAt", Date.now());
  }
  return allOk;
}
