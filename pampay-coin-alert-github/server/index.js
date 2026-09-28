/**
 * index.js — Pump & Dump Coins scanner server (Node.js / Express).
 * Deployable to Railway (Root Directory = server/). Node >= 18 required.
 *
 * Endpoints:
 *   GET  /health
 *   POST /scan/config           (app → sync scan configuration, secret-claimed)
 *   GET  /scan/signals          (app → fetch server-computed signals)
 *   POST /scan/run              (manual trigger)
 *   GET  /nobitex/usdt-toman    (USDT→Toman via Nobitex, bundled proxy)
 *   GET  /alanchand/usdt-toman  (USDT→Toman via Alan.Chand, bundled proxy)
 *   POST /push/register         (native push token registration)
 *   POST /push/unregister
 *   POST /ai/generate           (OpenAI-compatible proxy for the app's AI client)
 *
 * Scheduler: a 60s tick drives the same cadence as the original Cloudflare
 * Durable Object alarm — hourly ticks, daily UTC-midnight scan and catch-up
 * scans are all deduped inside runScanCycle().
 */
const express = require('express');
const store = require('./store');
const scanner = require('./scanner');

const app = express();
app.use(express.json({ limit: '1mb' }));

const VERSION = '1.0.0';
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ ok: true, version: VERSION, uptime: process.uptime() });
});

// Alias — the Railway TS build (server/src/index.ts) uses /ping, so keep
// both paths alive for clients that test either one.
app.get('/ping', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), service: 'pampay-coin-alert' });
});

// ---------------------------------------------------------------------------
// Scan config / signals / manual run
// ---------------------------------------------------------------------------
app.post('/scan/config', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.secret || typeof body.secret !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing secret' });
    }

    const existing = await store.get('config');
    if (existing && existing.secret !== body.secret) {
      return res.status(403).json({ ok: false, error: 'unauthorized' });
    }

    const indicators = Array.isArray(body.indicators)
      ? body.indicators
          .filter((i) => i && typeof i.id === 'string' && typeof i.code === 'string')
          .slice(0, 30)
          .map((i) => ({
            id: i.id,
            name: String(i.name ?? '').slice(0, 60),
            code: i.code.slice(0, 8000),
            timeframe: ['15m', '30m', '1h', '4h', '1d'].includes(i.timeframe) ? i.timeframe : '1d',
            receiveSignals: !!i.receiveSignals,
          }))
      : [];

    const rawTfs = Array.isArray(body.gainzTimeframes) ? body.gainzTimeframes : [];
    const gainzTimeframes = rawTfs.filter(
      (t) => t === '15m' || t === '30m' || t === '1h' || t === '4h' || t === '1d'
    );

    const rawHookTfs = Array.isArray(body.hookTimeframes) ? body.hookTimeframes : [];
    const hookTimeframes = rawHookTfs.filter((t) => t === '4h' || t === '1d');

    const cfg = {
      secret: body.secret,
      botToken: (body.botToken ?? '').trim(),
      chatId: (body.chatId ?? '').trim(),
      gainzAlgoEnabled: body.gainzAlgoEnabled !== false,
      gainzTimeframes: gainzTimeframes.length > 0 ? gainzTimeframes : ['1d'],
      indicators,
      hookEnabled: body.hookEnabled === true,
      hookTimeframes: hookTimeframes.length > 0 ? hookTimeframes : ['1d'],
    };
    await store.put('config', cfg);

    // Catch-up: if today's scan hasn't happened yet (app was closed across
    // midnight), run it right away so the user gets missed signals.
    const lastScanDate = (await store.get('lastScanDate')) ?? '';
    if (cfg.botToken && cfg.chatId && lastScanDate !== scanner.utcDateStr()) {
      const summary = await scanner.runScanCycle('catchup');
      return res.json({ ok: true, scanned: true, summary });
    }
    return res.json({ ok: true, scanned: false });
  } catch (e) {
    console.log('[Server] /scan/config error:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

app.get('/scan/signals', async (_req, res) => {
  const [gainz, custom, hook, lastScanDate, lastScanAt] = await Promise.all([
    store.get('gainzSignals', []),
    store.get('customSignals', []),
    store.get('hookSignals', []),
    store.get('lastScanDate'),
    store.get('lastScanAt'),
  ]);

  // Lazy catch-up without blocking the response.
  if (lastScanDate && lastScanDate !== scanner.utcDateStr()) {
    scanner.runScanCycle('catchup').catch((e) =>
      console.log('[Server] catchup failed:', e)
    );
  }

  res.json({
    ok: true,
    gainzSignals: gainz ?? [],
    customSignals: custom ?? [],
    hookSignals: hook ?? [],
    lastScanDate: lastScanDate ?? null,
    lastScanAt: lastScanAt ?? null,
  });
});

app.post('/scan/run', async (_req, res) => {
  const summary = await scanner.runScanCycle('manual');
  res.json({ ok: !summary.skipped, summary });
});

// ---------------------------------------------------------------------------
// Toman price proxies (bundled from functions/)
// ---------------------------------------------------------------------------
const { getNobitexUsdtToman } = require('./lib/nobitex.js');
const { getAlanchandUsdtToman } = require('./lib/alanchand.js');

app.get('/nobitex/usdt-toman', async (_req, res) => {
  try {
    const result = await getNobitexUsdtToman({
      NOBITEX_API_PUBLIC_KEY: process.env.NOBITEX_API_PUBLIC_KEY,
      NOBITEX_API_PRIVATE_KEY: process.env.NOBITEX_API_PRIVATE_KEY,
    });
    res.json(result);
  } catch (e) {
    console.log('[Server] nobitex proxy error:', e);
    res.status(502).json({ usdtToToman: 0, source: 'unavailable' });
  }
});

app.get('/alanchand/usdt-toman', async (_req, res) => {
  try {
    const result = await getAlanchandUsdtToman({
      NOBITEX_API_PUBLIC_KEY: process.env.NOBITEX_API_PUBLIC_KEY,
      NOBITEX_API_PRIVATE_KEY: process.env.NOBITEX_API_PRIVATE_KEY,
    });
    res.json(result);
  } catch (e) {
    console.log('[Server] alanchand proxy error:', e);
    res.status(502).json({ usdtToToman: 0, source: 'unavailable' });
  }
});

// ---------------------------------------------------------------------------
// Native push registration
// ---------------------------------------------------------------------------
app.post('/push/register', async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ ok: false, error: 'missing token' });
  }
  await store.pushRegister(token, platform === 'ios' ? 'ios' : 'android');
  res.json({ ok: true });
});

app.post('/push/unregister', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'missing token' });
  await store.pushUnregister(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI proxy (OpenAI-compatible) — used by utils/aiClient.ts mode 1
// ---------------------------------------------------------------------------
app.post('/ai/generate', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY not configured' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: 'missing messages' });
  }

  try {
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });
    if (!upstream.ok) {
      console.log(`[Server] ai upstream ${upstream.status}`);
      return res.status(502).json({ ok: false, error: 'upstream error' });
    }
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    let object = null;
    try {
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = fenced ? fenced[1] : content;
      const s = raw.indexOf('{');
      const e2 = raw.lastIndexOf('}');
      object = JSON.parse(raw.slice(s, e2 + 1));
    } catch {
      object = null;
    }
    if (!object) return res.status(502).json({ ok: false, error: 'invalid json from model' });
    res.json({ ok: true, object });
  } catch (e) {
    console.log('[Server] ai/generate error:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ---------------------------------------------------------------------------
// Scheduler (60s tick — dedupe handled by runScanCycle)
// ---------------------------------------------------------------------------
let schedulerStarted = false;
function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  console.log('[Server] scheduler started (60s tick, UTC-hourly cadence)');
  setInterval(() => {
    scanner
      .runScanCycle('alarm')
      .then((summary) => {
        if (summary && !summary.skipped) {
          console.log('[Server] scheduled cycle summary:', summary);
        }
      })
      .catch((e) => console.log('[Server] scheduled cycle failed:', e));
  }, 60_000);
}

app.listen(PORT, () => {
  console.log(`[Server] pump-dump scanner server v${VERSION} on :${PORT}`);
  startScheduler();
});

module.exports = app;
