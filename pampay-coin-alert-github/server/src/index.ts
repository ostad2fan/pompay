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
import { sendTelegram, getLastTelegramError } from "./telegram";
import {
  startBotCommandPoller,
  getPendingForApp,
  ackPendingForApp,
} from "./botCommands";
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
      const [config, lastScanDate, lastScanAt, lastFastScanAt, lastTelegramError, lastTelegramSuccessAt] = await Promise.all([
        store.get<{ secret: string; botToken: string; chatId: string }>("config"),
        store.get<string>("lastScanDate"),
        store.get<number>("lastScanAt"),
        store.get<number>("lastFastScanAt"),
        getLastTelegramError(),
        store.get<number>("lastTelegramSuccessAt"),
      ]);
      return json(res, 200, {
        ok: true,
        hasConfig: Boolean(config),
        telegramConfigured: Boolean(config?.botToken && config?.chatId),
        serverBotCommands: true,
        lastScanDate: lastScanDate ?? null,
        lastScanAt: lastScanAt ?? null,
        lastFastScanAt: lastFastScanAt ?? null,
        telegram: {
          lastSuccessAt: lastTelegramSuccessAt ?? null,
          lastError: lastTelegramError ?? null,
        },
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

    // ---- GitHub update relay (v1.4.3) ----
    if (req.method === "GET" && url.pathname === "/latest-version") {
      try {
        const body = await fetchVersionJsonBody();
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Relay-Source": "github",
        });
        res.end(body);
        return;
      } catch (e) {
        return json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (req.method === "GET" && url.pathname === "/latest-apk") {
      try {
        const upstream = await fetch(APK_URL, {
          headers: { "User-Agent": "pompay-server" },
        });
        if (!upstream.ok) {
          return json(res, 502, { ok: false, error: `github ${upstream.status}` });
        }
        res.writeHead(200, {
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": 'attachment; filename="PampDumpCoins-latest.apk"',
          "Cache-Control": "no-store",
        });
        // Node 20+: web ReadableStream can be piped after conversion
        const nodeStream = upstream.body as unknown as NodeJS.ReadableStream;
        if (nodeStream && typeof (nodeStream as { pipe?: unknown }).pipe === "function") {
          nodeStream.pipe(res);
        } else {
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        }
        return;
      } catch (e) {
        return json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ---- bot command relay (v1.4.3) ----
    if (req.method === "GET" && url.pathname === "/bot/pending") {
      const secret = String(url.searchParams.get("secret") ?? "");
      const commands = await getPendingForApp(secret);
      return json(res, 200, { ok: commands.length > 0, commands });
    }
    if (req.method === "POST" && url.pathname === "/bot/ack") {
      const raw = await readBody(req);
      try {
        const body = JSON.parse(raw || "{}") as { secret?: string; ids?: number[] };
        const removed = await ackPendingForApp(String(body.secret ?? ""), body.ids ?? []);
        return json(res, 200, { ok: true, removed });
      } catch {
        return json(res, 400, { ok: false, error: "invalid json" });
      }
    }

    // ---- v1.4.4: one-button server→Telegram health check ----
    // The app calls this from Settings («تست ارسال تلگرام از سرور») to verify
    // the exact 24/7 notification path. Secret-protected so strangers can't
    // spam the configured chat.
    if (req.method === "GET" && url.pathname === "/bot/test") {
      const secret = String(url.searchParams.get("secret") ?? "");
      const cfg = await store.get<{ secret?: string; botToken?: string; chatId?: string }>("config");
      if (!cfg?.botToken || !cfg.chatId) {
        return json(res, 400, {
          ok: false,
          detail: "توکن ربات/چت‌آیدی هنوز روی سرور ثبت نشده — اول دکمه «همگام‌سازی پیکربندی اسکنر» را بزنید",
        });
      }
      if (!secret || cfg.secret !== secret) {
        return json(res, 403, {
          ok: false,
          detail: "راز نصب (secret) مطابقت ندارد — از همان گوشی که پیکربندی را ثبت کرده این تست را بزنید",
        });
      }
      const sent = await sendTelegram(
        { botToken: cfg.botToken, chatId: cfg.chatId },
        "✅ <b>پیام تست سرور PomPay</b>\n\nمسیر اعلان‌های ۲۴ ساعته (حتی با برنامه بسته) سالم است."
      );
      const lastErr = await getLastTelegramError();
      if (sent) {
        return json(res, 200, { ok: true, detail: "پیام تست ارسال شد" });
      }
      return json(res, 502, {
        ok: false,
        detail: "تلگرام پیام را نپذیرفت — توکن ربات یا چت‌آیدی همگام‌شده معتبر نیست",
        error: lastErr?.error ?? null,
      });
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
  // v1.4.3: server-side Telegram command processing (24/7, even with the
  // app closed). Starts polling getUpdates as soon as a bot token is synced.
  // v1.4.5: boot-wrapped so a poller startup bug can never kill the service.
  try {
    startBotCommandPoller();
  } catch (e) {
    console.log("[Server] bot command poller failed to start (non-fatal):", e);
  }
});

// --- v1.4.5: global crash protection -----------------------------------------
// Railway restarts a crashed container only 5 times (ON_FAILURE policy) and
// then leaves the service DOWN (HTTP 502 forever). Any unexpected error must
// be LOGGED, never fatal — the 24/7 Telegram alerts are the app's core value.
process.on("uncaughtException", (e) => {
  console.log("[Server] UNCAUGHT EXCEPTION (kept alive):", e);
});
process.on("unhandledRejection", (reason) => {
  console.log("[Server] UNHANDLED REJECTION (kept alive):", reason);
});
// Memory guard: log when the RSS grows past 450MB so OOM kills are diagnosable.
setInterval(() => {
  try {
    const rss = process.memoryUsage().rss;
    if (rss > 450 * 1024 * 1024) {
      console.log(`[Server] high memory: ${(rss / 1024 / 1024).toFixed(0)}MB RSS`);
    }
  } catch {}
}, 60_000).unref();

// --- GitHub update relay (v1.4.3) -------------------------------------------
// raw.githubusercontent.com is blocked on many Iranian ISPs. The app now
// checks for updates via THIS server first (/latest-version) and downloads
// the APK via /latest-apk when jsDelivr and GitHub are both unreachable.
// v1.4.10: version.json is fetched with a cache-buster (GitHub raw caches 5
// minutes upstream) and falls back to the jsDelivr CDN mirror when raw is
// slow/unreachable — the relay itself caches for max 60 seconds so a fresh
// release is visible almost immediately.

const VERSION_JSON_URL =
  "https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json";
const VERSION_JSON_CDN_URL =
  "https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/version.json";
const APK_URL =
  "https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/PampDumpCoins-latest.apk";

let versionCache: { at: number; body: string } | null = null;

async function fetchVersionJsonBody(): Promise<string> {
  // 60s only — a just-pushed release must show up almost immediately.
  if (versionCache && Date.now() - versionCache.at < 60_000) {
    return versionCache.body;
  }
  const bust = `?t=${Date.now()}`;
  for (const url of [`${VERSION_JSON_URL}${bust}`, `${VERSION_JSON_CDN_URL}${bust}`]) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "pompay-server", Accept: "application/json" },
      });
      if (!res.ok) continue;
      const parsed = await res.json();
      if (!parsed || !parsed.latestVersion || !parsed.apkUrl) continue;
      const body = JSON.stringify(parsed);
      versionCache = { at: Date.now(), body };
      return body;
    } catch {
      // try the next mirror
    }
  }
  if (versionCache) return versionCache.body;
  throw new Error("version.json unreachable (raw + cdn)");
}

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
