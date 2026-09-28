// server/src/index.ts
// PamPay Coin Alert — backend server (Node.js port of the Rork Cloudflare
// Worker + Durable Object). Deployable on Railway / any Node host.
//
// Routes (identical contract to the original worker):
//   GET  /ping                    — health check
//   GET  /nobitex/usdt-toman      — USDT/Toman price via Nobitex
//   GET  /alanchand/usdt-toman    — USDT/Toman price via Alan.Chand
//   POST /scan/config             — app syncs its scan configuration (secret-claimed)
//   GET  /scan/signals            — app fetches latest server-computed signals
//   POST /scan/run                — manual scan trigger
//   GET  /scan/status             — debug: last scan time, config present
//   POST /push/register           — register an Expo push token
//   POST /push/unregister         — remove a push token
//   GET  /push/status             — how many devices are registered
//
// Scheduled: an hourly tick drives the same scan logic the Durable Object
// alarm used (daily UTC-midnight scan, 1h/4h candle-close checks, catch-up).

import http from "http";
import { URL } from "url";
import { getAlanchandUsdtToman } from "./alanchand";
import { getNobitexUsdtToman } from "./nobitex";
import { scanEngine } from "./scanEngine";
import { runFastScanCycle, pumpDumpResponse } from "./fastScan";
import { registerPushToken, unregisterPushToken, pushStatus } from "./push";
import store from "./store";

const PORT = Number(process.env.PORT ?? 8080);

// --- Tiny CORS + JSON helpers (no framework dependency) ---------------------

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage, limitBytes = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// --- Request routing ---------------------------------------------------------

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const started = Date.now();
  try {
    // ---- health & prices ----
    if (req.method === "GET" && (url.pathname === "/ping" || url.pathname === "/health")) {
      return json(res, 200, { ok: true, now: new Date().toISOString(), service: "pampay-coin-alert" });
    }
    if (req.method === "GET" && url.pathname === "/nobitex/usdt-toman") {
      return json(res, 200, await getNobitexUsdtToman());
    }
    if (req.method === "GET" && url.pathname === "/alanchand/usdt-toman") {
      return json(res, 200, await getAlanchandUsdtToman());
    }

    // ---- scan server ----
    if (req.method === "POST" && url.pathname === "/scan/config") {
      const raw = await readBody(req);
      let body: unknown = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return json(res, 400, { ok: false, error: "invalid json" });
      }
      const { status, payload } = await scanEngine.handleConfig(body);
      return json(res, status, payload);
    }
    if (req.method === "GET" && url.pathname === "/scan/signals") {
      return json(res, 200, await scanEngine.signalsResponse());
    }
    if (req.method === "GET" && url.pathname === "/scan/pumpdump") {
      const thresholdRaw = Number(url.searchParams.get("threshold") ?? "");
      const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : undefined;
      return json(res, 200, await pumpDumpResponse(threshold));
    }
    if (req.method === "POST" && url.pathname === "/scan/fast-run") {
      const summary = await runFastScanCycle("manual");
      return json(res, 200, { ok: true, summary });
    }
    if (req.method === "POST" && url.pathname === "/scan/run") {
      const summary = await scanEngine.runScanCycle("manual");
      return json(res, 200, { ok: !summary.skipped, summary });
    }
    if (req.method === "GET" && url.pathname === "/scan/status") {
      const [config, lastScanDate, lastScanAt, lastFastScanAt] = await Promise.all([
        store.get<{ secret: string; botToken: string; chatId: string }>("config"),
        store.get<string>("lastScanDate"),
        store.get<number>("lastScanAt"),
        store.get<number>("lastFastScanAt"),
      ]);
      return json(res, 200, {
        ok: true,
        hasConfig: Boolean(config),
        telegramConfigured: Boolean(config?.botToken && config?.chatId),
        lastScanDate: lastScanDate ?? null,
        lastScanAt: lastScanAt ?? null,
        lastFastScanAt: lastFastScanAt ?? null,
        push: await pushStatus(),
      });
    }

    // ---- push notifications ----
    if (req.method === "POST" && url.pathname === "/push/register") {
      const raw = await readBody(req);
      try {
        const body = JSON.parse(raw || "{}") as { token?: string };
        const result = await registerPushToken(body.token ?? "");
        return json(res, result.ok ? 200 : 400, result);
      } catch {
        return json(res, 400, { ok: false, error: "invalid json" });
      }
    }
    if (req.method === "POST" && url.pathname === "/push/unregister") {
      const raw = await readBody(req);
      try {
        const body = JSON.parse(raw || "{}") as { token?: string };
        return json(res, 200, await unregisterPushToken(body.token ?? ""));
      } catch {
        return json(res, 400, { ok: false, error: "invalid json" });
      }
    }
    if (req.method === "GET" && url.pathname === "/push/status") {
      return json(res, 200, await pushStatus());
    }

    return json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    console.log(`[HTTP] error on ${req.method} ${url.pathname}:`, e);
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    console.log(`[HTTP] ${req.method} ${url.pathname} -> ${Date.now() - started}ms`);
  }
});

server.listen(PORT, () => {
  console.log(`[Server] PamPay Coin Alert backend listening on :${PORT}`);
  console.log(`[Server] push configured: ${process.env.EXPO_ACCESS_TOKEN ? "yes (access token)" : "no token (open mode)"}`);
});

// --- Hourly scheduler (replaces Durable Object alarms) -----------------------
// Fires once per UTC hour at minute 0 (checked every 20s for precision), plus
// one catch-up tick right after boot.

let lastTickHour = -1;

async function tick(reason: string): Promise<void> {
  try {
    await scanEngine.alarmTick();
  } catch (e) {
    console.log(`[Scheduler] ${reason} tick failed:`, e);
  }
}

setTimeout(() => void tick("boot-catchup"), 15_000);

setInterval(() => {
  const now = new Date();
  if (now.getUTCHours() !== lastTickHour && now.getUTCMinutes() >= 0) {
    lastTickHour = now.getUTCHours();
    void tick("hourly");
  }
}, 20_000);

// --- Fast scheduler (every 10 minutes) ----------------------------------------
// Pump/dump scanner, meme short signals, pre-listing candidates and 15m
// custom indicators — so intraday alerts reach Telegram + push with the app
// fully closed. Throttling happens inside each cycle.

async function fastTick(reason: string): Promise<void> {
  try {
    await runFastScanCycle("timer");
  } catch (e) {
    console.log(`[Scheduler] ${reason} fast tick failed:`, e);
  }
  try {
    await scanEngine.quickTick();
  } catch (e) {
    console.log(`[Scheduler] ${reason} quick tick failed:`, e);
  }
}

setTimeout(() => void fastTick("boot"), 45_000);

setInterval(() => {
  void fastTick("10min");
}, 10 * 60_000);

// --- Graceful shutdown --------------------------------------------------------

function shutdown(signal: string): void {
  console.log(`[Server] ${signal} received — flushing state and closing`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
