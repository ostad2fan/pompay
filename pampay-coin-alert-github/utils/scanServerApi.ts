import AsyncStorage from '@react-native-async-storage/async-storage';
import { TradeSignal } from '@/types/crypto';
import { GainzAlgoSignal } from '@/utils/gainzAlgoService';
import {
  CustomIndicatorSignal,
  UserIndicator,
  getUserIndicators,
} from '@/utils/customIndicatorsService';
import { HookReversalSignal } from '@/utils/hookReversalService';

/**
 * Client bridge to the server-side scheduled scanner (Node.js server, deployable
 * on Railway). The server runs the hourly/4h/daily scans even when the app is
 * fully closed and announces new signals on Telegram. The app syncs its config
 * (bot token, chat id, indicators), can fetch server-computed signals and
 * register native push tokens.
 */

const SECRET_KEY = '@scan_server_secret';
const SERVER_URL_KEY = '@scan_server_url';

/**
 * The project's own backend, always baked into the app. Users who deploy
 * their own copy (Railway/other host) can freely override it in
 * Settings → «سرور اسکنر».
 */
const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_SCANNER_SERVER_URL ?? 'https://pompay-production.up.railway.app';

let cachedServerUrl: string | null = null;

export interface ServerSignalsResponse {
  gainzSignals: GainzAlgoSignal[];
  customSignals: CustomIndicatorSignal[];
  hookSignals: HookReversalSignal[];
  lastScanDate: string | null;
  lastScanAt: number | null;
}

/** Dynamic server URL: AsyncStorage override → env default → ''. */
export async function getServerUrl(): Promise<string> {
  if (cachedServerUrl !== null) return cachedServerUrl;
  try {
    const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
    cachedServerUrl = (stored && stored.trim()) || DEFAULT_SERVER_URL;
  } catch {
    cachedServerUrl = DEFAULT_SERVER_URL;
  }
  return cachedServerUrl ?? '';
}

export async function setServerUrl(url: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  cachedServerUrl = clean;
  try {
    await AsyncStorage.setItem(SERVER_URL_KEY, clean);
  } catch {}
}

/**
 * Quick reachability check. The Railway backend (server/src/index.ts)
 * exposes /ping, while the Express build (server/index.js) exposes /health —
 * try all of them so the test works against ANY deployment of this project.
 * Accepts any endpoint that answers HTTP 200 + {ok:true} (or /scan/status).
 * v1.4.5: per-path timeout cut to 6s (was 12s → 36s total "delay") and
 * distinguishes WHY the check failed — a 502/503 from Railway means the
 * server service is DOWN and must be redeployed, not a wrong URL.
 * v1.4.6: when ALL paths time out at network level, an INTERNET PROBE
 * (binance / google / github in parallel) decides between the two very
 * different causes: «سرور خاموش است» vs «اینترنت/فیلترشکن شما قطع است» —
 * previously the app always blamed the user's internet, which was wrong
 * whenever the Railway service itself was hung (TLS opens, no answer).
 */
export interface ServerTestResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  via?: string;
  /** v1.4.5 — human-readable Persian reason for settings display. */
  reason?: string;
}

/** Any of these answering = the phone's internet (incl. VPN) works. */
async function probeInternet(): Promise<boolean> {
  const probes = [
    'https://api.binance.com/api/v3/ping',
    'https://www.google.com/generate_204',
    'https://raw.githubusercontent.com/ostad2fan/pompay/main/README.md',
  ];
  const results = await Promise.all(
    probes.map(async (u) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4_000);
        try {
          const res = await fetch(u, { method: 'GET', signal: controller.signal });
          return res.ok || res.status === 204;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return false;
      }
    })
  );
  return results.some(Boolean);
}

export async function testServerUrl(url: string): Promise<ServerTestResult> {
  const clean = url.trim().replace(/\/+$/, '');
  const started = Date.now();
  let sawBadGateway = false;
  let sawNotFound = false;
  let sawOtherHttp = false;
  for (const path of ['/ping', '/health', '/scan/status']) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      const res = await fetch(`${clean}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      if (res.ok) {
        try {
          const data = (await res.json()) as { ok?: boolean; version?: string; service?: string };
          if (data && (data.ok === true || data.ok === undefined)) {
            return {
              ok: true,
              latencyMs,
              version: data.version ?? data.service,
              via: path,
            };
          }
        } catch {
          // 200 but not JSON — still a live server
          return { ok: true, latencyMs, via: path };
        }
      }
      // Non-OK response: endpoint not found on this server → try next path.
      if (res.status === 502 || res.status === 503 || res.status === 504) sawBadGateway = true;
      else if (res.status === 404) sawNotFound = true;
      else sawOtherHttp = true;
    } catch {
      // network error / timeout → try next path
    }
  }
  const latencyMs = Date.now() - started;
  if (sawBadGateway) {
    return {
      ok: false,
      latencyMs,
      reason:
        'سرور خاموش/کرش است (خطای 502 از Railway) — آدرس درست است؛ سرویس را در پنل Railway دوباره دیپلوی/ری‌استارت کنید',
    };
  }
  if (sawNotFound) {
    return {
      ok: false,
      latencyMs,
      reason: 'چنین سروری روی این آدرس پیدا نشد (404) — آدرس را دقیق چک کنید',
    };
  }
  if (sawOtherHttp) {
    return { ok: false, latencyMs, reason: 'سرور پاسخ خطا داد — بعداً دوباره امتحان کنید' };
  }
  // All paths timed out / unreachable — distinguish server-side vs client-side.
  const internetUp = await probeInternet();
  if (internetUp) {
    return {
      ok: false,
      latencyMs,
      reason:
        'اینترنت شما سالم است اما سرور پاسخ نمی‌دهد — سرور Railway خاموش یا معلق شده؛ از پنل Railway سرویس را Redeploy/Restart کنید',
    };
  }
  return {
    ok: false,
    latencyMs,
    reason:
      'اینترنت گوشی یا فیلترشکن قطع است — فیلترشکن را روشن کنید و دوباره تست بزنید (اگر با فیلترشکن روشن هم همین خطا آمد، آدرس سرور را چک کنید)',
  };
}

/** Stable per-install secret: first config sync claims the server config. */
export async function getInstallSecret(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(SECRET_KEY);
    if (existing) return existing;
    const secret = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(SECRET_KEY, secret);
    return secret;
  } catch {
    return 's-fallback';
  }
}

export interface ScanConfigSyncResult {
  ok: boolean;
  /** v1.4.7 — precise Persian reason (server down vs VPN off vs bad token). */
  reason?: string;
}

/**
 * Pushes the scan configuration to the server (bot token, chat id, GainzAlgo
 * flag, the user's custom indicators and the fast-cycle flags: pump/dump
 * scanner, meme short, pre-listing + volume threshold). The server then
 * announces ALL sections' signals on Telegram + push while the app is closed.
 */
export async function syncScanConfig(params: {
  botToken: string;
  chatId: string;
  gainzAlgoEnabled: boolean;
  gainzTimeframes: ('15m' | '30m' | '1h' | '4h' | '1d')[];
  hookEnabled: boolean;
  hookTimeframes: ('4h' | '1d')[];
  scannerEnabled?: boolean;
  memeEnabled?: boolean;
  preListingEnabled?: boolean;
  volumeThreshold?: number;
}): Promise<ScanConfigSyncResult> {
  const serverUrl = await getServerUrl();
  if (!serverUrl || !params.botToken || !params.chatId) {
    return { ok: false, reason: 'توکن ربات تلگرام یا چت‌آیدی تنظیم نشده است — ابتدا آن‌ها را در همین صفحه وارد کنید' };
  }
  try {
    const indicators: UserIndicator[] = await getUserIndicators();
    // v1.4.5: 12s timeout — previously hung for minutes when the server was down.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/scan/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: await getInstallSecret(),
          botToken: params.botToken,
          chatId: params.chatId,
          gainzAlgoEnabled: params.gainzAlgoEnabled,
          gainzTimeframes: params.gainzTimeframes,
          hookEnabled: params.hookEnabled,
          hookTimeframes: params.hookTimeframes,
          scannerEnabled: params.scannerEnabled,
          memeEnabled: params.memeEnabled,
          preListingEnabled: params.preListingEnabled,
          volumeThreshold: params.volumeThreshold,
          indicators,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.log(`[ScanServer] config sync failed: ${res.status}`);
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        return {
          ok: false,
          reason: 'سرور خاموش/کرش است (خطای 502 از Railway) — آدرس درست است؛ سرویس را در پنل Railway دوباره دیپلوی کنید',
        };
      }
      if (res.status === 404) {
        return {
          ok: false,
          reason: 'این آدرس سرور ما نیست (404) — آدرس سرور اسکنر را دقیق چک کنید',
        };
      }
      return { ok: false, reason: `سرور پیکربندی را نپذیرفت (HTTP ${res.status}) — آدرس و توکن ربات/چت‌آیدی را چک کنید` };
    }
    const data = (await res.json()) as { scanned?: boolean };
    console.log(`[ScanServer] config synced (catchupScan=${!!data.scanned})`);
    return { ok: true };
  } catch (e) {
    console.log('[ScanServer] config sync error:', e);
    // v1.4.7 — same smart diagnosis as the connection test: decide whether the
    // phone's internet is down or the Railway service itself is unresponsive.
    const internetUp = await probeInternet();
    return {
      ok: false,
      reason: internetUp
        ? 'اینترنت شما سالم است اما سرور پاسخ نمی‌دهد — سرور Railway خاموش یا معلق شده؛ از پنل Railway سرویس را Redeploy/Restart کنید'
        : 'اینترنت گوشی یا فیلترشکن قطع است — فیلترشکن را روشن کنید و دوباره امتحان کنید',
    };
  }
}

/** Fetches the signals the server has computed (usable when the app was closed). */
export async function fetchServerSignals(): Promise<ServerSignalsResponse | null> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/scan/signals`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ServerSignalsResponse> & { ok?: boolean };
    return {
      gainzSignals: Array.isArray(data.gainzSignals) ? data.gainzSignals : [],
      customSignals: Array.isArray(data.customSignals) ? data.customSignals : [],
      hookSignals: Array.isArray(data.hookSignals) ? data.hookSignals : [],
      lastScanDate: data.lastScanDate ?? null,
      lastScanAt: data.lastScanAt ?? null,
    };
  } catch (e) {
    console.log('[ScanServer] fetch signals error:', e);
    return null;
  }
}

/**
 * Pump/dump signals computed ON THE SERVER (Binance is reachable from the
 * Railway server even where direct phone access is geo-blocked, e.g. Iran).
 * The home-scanner falls back to this when the direct Binance scan fails or
 * returns nothing.
 */
export async function fetchServerPumpDumpSignals(
  volumeThreshold: number
): Promise<TradeSignal[] | null> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${serverUrl}/scan/pumpdump?threshold=${volumeThreshold}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      signals?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(data.signals)) return null;
    return data.signals.map((s) => ({
      id: String(s.id ?? `srv-${Math.random()}`),
      symbol: String(s.symbol ?? ''),
      displayName: String(s.displayName ?? ''),
      signalType: (s.signalType === 'dump' ? 'dump' : 'pump') as TradeSignal['signalType'],
      currentPrice: Number(s.currentPrice ?? 0),
      priceChangePercent: Number(s.priceChangePercent ?? 0),
      volume24h: Number(s.volume24h ?? 0),
      volumeChangeRatio: Number(s.volumeChangeRatio ?? 0),
      buyVolumeRatio: Number(s.buyVolumeRatio ?? 0.5),
      sellVolumeRatio: Number(s.sellVolumeRatio ?? 0.5),
      suggestedEntry: Number(s.suggestedEntry ?? 0),
      suggestedTarget: Number(s.suggestedTarget ?? 0),
      suggestedStopLoss: Number(s.suggestedStopLoss ?? 0),
      strength: (s.strength === 'high' || s.strength === 'medium' ? s.strength : 'low') as TradeSignal['strength'],
      detectedAt: new Date(Number(s.detectedAt ?? Date.now())),
      reason: String(s.reason ?? ''),
      fundingRate: Number(s.fundingRate ?? 0),
      timeframe: String(s.timeframe ?? '1h'),
    }));
  } catch (e) {
    console.log('[ScanServer] fetch pump/dump error:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// v1.4.3 — server-side Telegram bot commands
//
// The server answers bot commands 24/7 (even with the app closed). Commands
// that need app-local data (/balance /positions /signals /whale) are queued
// server-side; the app fetches them here and answers, then acks.
// ---------------------------------------------------------------------------

/** A command queued by the server, waiting for the app to answer it. */
export interface PendingBotCommand {
  id: number;
  command: string;
  chatId: string;
  receivedAt: number;
}

let botCommandsSupportCache: { at: number; supported: boolean } | null = null;
const SUPPORT_CACHE_MS = 10 * 60_000;

/**
 * Whether the configured server supports server-side bot command handling
 * (/scan/status → serverBotCommands). When true the app stops its own
 * getUpdates polling (the server consumes updates instead). Cached 10 min.
 */
export async function serverSupportsBotCommands(): Promise<boolean> {
  if (botCommandsSupportCache && Date.now() - botCommandsSupportCache.at < SUPPORT_CACHE_MS) {
    return botCommandsSupportCache.supported;
  }
  const serverUrl = await getServerUrl();
  if (!serverUrl) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${serverUrl}/scan/status`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = (await res.json()) as { serverBotCommands?: boolean };
    const supported = data?.serverBotCommands === true;
    botCommandsSupportCache = { at: Date.now(), supported };
    return supported;
  } catch {
    // Network error → don't cache; assume the old behavior (local polling)
    // so commands keep working while the server is unreachable.
    return false;
  }
}

/** Resets the support cache (e.g. after the user changes the server URL). */
export function resetBotCommandsSupportCache(): void {
  botCommandsSupportCache = null;
}

/** Queued commands the app should answer (empty when the secret doesn't match). */
export async function fetchPendingBotCommands(): Promise<PendingBotCommand[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(
        `${serverUrl}/bot/pending?secret=${encodeURIComponent(await getInstallSecret())}`,
        { headers: { Accept: 'application/json' }, signal: controller.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { commands?: PendingBotCommand[] };
    return Array.isArray(data.commands) ? data.commands : [];
  } catch {
    return [];
  }
}

/** Marks queued commands as answered (after the app replied to the user). */
export async function ackBotCommands(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      await fetch(`${serverUrl}/bot/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: await getInstallSecret(), ids }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // non-fatal — the command stays queued and will be re-answered later
  }
}

/**
 * Asks the SERVER to send a test Telegram message with the synced bot config
 * (GET /bot/test?secret=...). This verifies the exact server→Telegram path
 * that runs 24/7 while the app is closed — the best one-button health check
 * for «چرا نوتیف تلگرام نمی‌آید؟».
 */
export async function sendServerTelegramTest(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return { ok: false, detail: 'آدرس سرور تنظیم نشده است' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(
        `${serverUrl}/bot/test?secret=${encodeURIComponent(await getInstallSecret())}`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
    } finally {
      clearTimeout(timer);
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      detail?: string;
      error?: string;
    } | null;
    if (res.ok && data?.ok) return { ok: true, detail: data.detail };
    if (res.status === 404) {
      return {
        ok: false,
        detail:
          'سرور شما نسخه قدیمی است — کد جدید سرور هنوز دیپلوی نشده (Railway را دوباره دیپلوی کنید)',
      };
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        ok: false,
        detail:
          'سرور خاموش/کرش است (502) — سرویس را در پنل Railway دوباره دیپلوی کنید',
      };
    }
    return {
      ok: false,
      detail:
        data?.detail ?? data?.error ?? `سرور پاسخ داد: HTTP ${res.status} — توکن ربات/چت‌آیدی همگام‌سازی شده را چک کنید`,
    };
  } catch {
    // v1.4.6 — the internet probe tells the user WHICH side is broken
    // (the Railway service hanging vs. the phone's own connection).
    const internetUp = await probeInternet();
    return {
      ok: false,
      detail: internetUp
        ? 'اینترنت شما سالم است اما سرور پاسخ نمی‌دهد — سرور Railway خاموش یا معلق شده؛ از پنل Railway سرویس را Redeploy/Restart کنید'
        : 'اینترنت گوشی یا فیلترشکن قطع است — فیلترشکن را روشن کنید و دوباره تست بزنید',
    };
  }
}
