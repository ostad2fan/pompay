// server/src/backtestEngine.ts
// v1.5.2 — 24/7 SERVER-SIDE backtest bot («اعلام تلگرام ۲۴/۷ برای بک‌تست»).
//
// v1.5.3 (user feedback):
//   • SL with leverage: «۳٪ حد ضرر با لوریج ۵ = دقیقاً ۱۵٪ ضرر حساب».
//   • New trailing: 1% spot move → risk-free; stop locks HALF the peak profit.
//   • Partial take-profit at 25% / 50% account profit (bot closes half).
//   • RESET endpoint flag (wipe everything, even history).
//   • Announce START/RESTART with the new settings + clear the stale
//     «ربات روی سرور متوقف شد» log so restarting never shows it again.
//   • Positions tagged with the active strategy label (history rows).
//   • announce() failures are surfaced into the app log (why Telegram silent).
//
// WHY: the user wants the backtest bot's DEMO **and** REAL signals announced
// on Telegram even when the app is fully closed («حتما برنامه بسته باشه این
// بخش فعالیت‌هاش در تل اعلام بشه»). The app pushes its bot config (and, in
// real mode, the Binance futures API keys) to this server; the server then
// runs the SAME trading cycle every 60 seconds around the clock:
//
//   • prices          — public Binance futures ticker
//   • demo positions  — MTM + SL/TP + trailing ratchet (identical math to
//                       the app's autoTradingEngine, including the
//                       breakeven+fee floor so a profitable trade can never
//                       close at a loss)
//   • real positions  — signed Binance orders (market entry + STOP_MARKET +
//                       TAKE_PROFIT_MARKET; trailing moves the stop), keys
//                       stored server-side ONLY for the user's own server
//   • whale mirror    — Hyperliquid clearinghouseState diff (open/close)
//   • indicator sigs  — the signal stores already maintained by scanEngine
//                       (hookSignals / gainzSignals / customSignals) filtered
//                       by the user's per-indicator timeframes
//   • Telegram        — every OPEN / CLOSE / PARTIAL announced with PnL
//
// Endpoints (in index.ts):
//   POST /autotrade/config  {secret, config}   — upsert + immediate cycle
//   GET  /autotrade/state?secret=...           — positions/logs for the app

import crypto from "crypto";
import store from "./store";
import { sendTelegram } from "./telegram";

// ---------------------------------------------------------------------------
// Types — mirror the app's autoTradingEngine shapes (subset that matters)
// ---------------------------------------------------------------------------

export type AutoMode = "demo" | "real";

export interface AutoCfg {
  enabled: boolean;
  mode: AutoMode;
  whale: { enabled: boolean; address: string; label: string; mirrorSide: boolean };
  indicators: { enabled: boolean; selections: { id: string; timeframes: string[] }[] };
  leverage: number;
  positionSizeUsd: number;
  maxLossPercent: number;
  rewardRatio: number;
  maxOpenPositions: number;
  trailing: { enabled: boolean; activationRatio: number; trailRatio: number };
  aiCapital: { enabled: boolean; dailyLossLimitPercent: number };
  initialCapitalUsd: number;
  /** v1.5.3 — نام استراتژی فعال (از تب بک‌تست اپ). */
  strategyLabel?: string;
  /** v1.5.4 — توکن تلگرام که اپ همراه کانفیگ فرستاده (اعلان‌های ۲۴/۷ بدون
   * راه‌اندازی جداگانه ربات تلگرام سرور — «حتی در تلگرام نمی‌آمد»). */
  telegram?: { botToken: string; chatId: string };
  binanceKeys?: { apiKey: string; apiSecret: string };
}

interface StoredAutoConfig {
  cfg: AutoCfg;
  whaleSnapshot: { coin: string; side: "long" | "short" }[];
  lastSignalAt: number;
  daily: { date: string; realized: number; entries: number };
  lossStreak: number;
  updatedAt: number;
}

interface BtPosition {
  id: string;
  symbol: string; // without USDT suffix (matches the app)
  side: "long" | "short";
  entryPrice: number;
  qty: number;
  sizeUsd?: number;
  leverage: number;
  stopPrice: number;
  takePrice: number;
  openedAt: number;
  source: "whale" | "indicator";
  sourceLabel: string;
  status: "open" | "closed";
  lastPrice: number;
  closeReason?: "stop" | "take" | "signal" | "whale-close" | "manual" | "partial" | "partial-manual";
  closedAt?: number;
  realizedPnl?: number;
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
  /** v1.5.3 — استراتژی فعال در لحظه باز شدن. */
  strategyName?: string;
  /** v1.5.3 — ۰/۱/۲ — چند بار ربات نصف حجم بسته (آستانه ۲۵٪/۵۰٪). */
  partialsDone?: number;
}

interface BtLog {
  id: string;
  at: number;
  kind: "open" | "close" | "error" | "info";
  message: string;
}

const CFG_KEY = "autoTradeConfig";
const STATE_KEY = "autoTradeState";
const CYCLE_MS = 60_000;
const FEE_ROUNDTRIP = 0.001;
const LOG_MAX = 60;
// v1.5.3 — تریلینگ جدید (طبق مشخصات کاربر)
const RISK_FREE_SPOT_PCT = 0.01; // ۱٪ حرکت اسپات → ریسک‌فری
const LOCK_RATIO = 0.5; // استاپ روی نصفِ بیشترین سود
const PARTIAL_TAKE_PNL_PCTS = [25, 50]; // آستانه‌های بستن نصف حجم
const PARTIAL_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

async function getConfig(): Promise<StoredAutoConfig | null> {
  return store.get<StoredAutoConfig>(CFG_KEY);
}

async function putConfig(c: StoredAutoConfig): Promise<void> {
  await store.put(CFG_KEY, c);
}

async function getState(): Promise<{ demo: BtPosition[]; real: BtPosition[]; logs: BtLog[]; lastCycleAt: number | null }> {
  return (
    (await store.get<{ demo: BtPosition[]; real: BtPosition[]; logs: BtLog[]; lastCycleAt: number | null }>(STATE_KEY)) ?? {
      demo: [],
      real: [],
      logs: [],
      lastCycleAt: null,
    }
  );
}

async function putState(s: { demo: BtPosition[]; real: BtPosition[]; logs: BtLog[]; lastCycleAt: number | null }): Promise<void> {
  await store.put(STATE_KEY, s);
}

async function appendLog(kind: BtLog["kind"], message: string): Promise<void> {
  const s = await getState();
  s.logs.unshift({ id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), kind, message });
  await putState({ ...s, logs: s.logs.slice(0, LOG_MAX) });
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** v1.5.3 — حذف لاگ‌های قدیمی «متوقف شد» (بعد از ری‌استارت دیگر دیده نشوند). */
async function dropStoppedLogs(): Promise<void> {
  const s = await getState();
  const filtered = s.logs.filter((l) => !l.message.includes("متوقف شد"));
  if (filtered.length !== s.logs.length) {
    await putState({ ...s, logs: filtered });
  }
}

// ---------------------------------------------------------------------------
// v1.5.4 — seed sanitizers: پوزیشن‌ها/لاگ‌هایی که اپ همراه کانفیگ می‌فرستد
// قبل از ذخیره در state سرور اعتبارسنجی می‌شوند (فیلدهای الزامی عددی/رشته‌ای).
// ---------------------------------------------------------------------------

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function sanitizePositions(rows: unknown[] | undefined): BtPosition[] {
  if (!Array.isArray(rows)) return [];
  const out: BtPosition[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const p = r as Record<string, unknown>;
    const id = String(p.id ?? "");
    const symbol = String(p.symbol ?? "");
    if (!id || !symbol) continue;
    out.push({
      id,
      symbol,
      side: p.side === "short" ? "short" : "long",
      entryPrice: num(p.entryPrice),
      qty: num(p.qty),
      sizeUsd: p.sizeUsd !== undefined ? num(p.sizeUsd) : undefined,
      leverage: num(p.leverage, 1) || 1,
      stopPrice: num(p.stopPrice),
      takePrice: num(p.takePrice),
      openedAt: num(p.openedAt, Date.now()) || Date.now(),
      source: p.source === "whale" ? "whale" : "indicator",
      sourceLabel: String(p.sourceLabel ?? ""),
      status: p.status === "closed" ? "closed" : "open",
      lastPrice: num(p.lastPrice, num(p.entryPrice)),
      closeReason:
        p.closeReason === "stop" || p.closeReason === "take" || p.closeReason === "signal" || p.closeReason === "whale-close" || p.closeReason === "manual" || p.closeReason === "partial" || p.closeReason === "partial-manual"
          ? p.closeReason
          : undefined,
      closedAt: p.closedAt !== undefined ? num(p.closedAt) : undefined,
      realizedPnl: p.realizedPnl !== undefined ? num(p.realizedPnl) : undefined,
      initialStopPrice: p.initialStopPrice !== undefined ? num(p.initialStopPrice) : undefined,
      highWater: p.highWater !== undefined ? num(p.highWater) : undefined,
      lowWater: p.lowWater !== undefined ? num(p.lowWater) : undefined,
      trailArmed: p.trailArmed === true,
      strategyName: p.strategyName !== undefined ? String(p.strategyName) : undefined,
      partialsDone: p.partialsDone !== undefined ? num(p.partialsDone) : undefined,
    });
  }
  return out.slice(0, 200);
}

function sanitizeLogs(rows: unknown[] | undefined): BtLog[] {
  if (!Array.isArray(rows)) return [];
  const out: BtLog[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const l = r as Record<string, unknown>;
    const id = String(l.id ?? "");
    const message = String(l.message ?? "");
    if (!id || !message) continue;
    out.push({
      id,
      at: num(l.at, Date.now()) || Date.now(),
      kind: l.kind === "open" || l.kind === "close" || l.kind === "error" || l.kind === "info" ? l.kind : "info",
      message,
    });
  }
  return out.slice(0, 60);
}

async function announce(title: string, text: string): Promise<void> {
  // v1.5.4 — اولویت با توکنی است که اپ همراه کانفیگ فرستاده (رباتِ خود کاربر)؛
  // اگر نبود، تنظیمات سرور (ربات تلگرام سرور) استفاده می‌شود.
  const btCfg = await getConfig();
  const serverCfg = await store.get<{ botToken?: string; chatId?: string }>("config");
  const botToken = btCfg?.cfg.telegram?.botToken ?? serverCfg?.botToken;
  const chatId = btCfg?.cfg.telegram?.chatId ?? serverCfg?.chatId;
  if (!botToken || !chatId) {
    // v1.5.3 — دلیل سکوت تلگرام در لاگ دیده شود («اعلان‌ها اصلا نمیاد» → معلوم چرا)
    await appendLog("error", "اعلام تلگرام ارسال نشد: توکن/چت‌آیدی تلگرام روی سرور ثبت نشده — ربات تلگرام را در تنظیمات برنامه وصل کنید");
    return;
  }
  const ok = await sendTelegram({ botToken, chatId }, `<b>${title}</b>\n${text}`);
  if (!ok) {
    await appendLog("error", "اعلام تلگرام ناموفق بود (توکن/چت‌آیدی نامعتبر یا شبکه) — پیام‌های ربات بک‌تست ارسال نمی‌شود");
  }
}

// ---------------------------------------------------------------------------
// Binance public prices + exchangeInfo (qty step)
// ---------------------------------------------------------------------------

let priceCache: { at: number; map: Record<string, number> } | null = null;

async function getPrices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.at < 15_000) return priceCache.map;
  const map: Record<string, number> = {};
  try {
    const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/price", {
      headers: { "User-Agent": "pompay-server" },
    });
    if (res.ok) {
      const rows = (await res.json()) as { symbol: string; price: string }[];
      for (const r of rows) map[r.symbol] = parseFloat(r.price);
    }
  } catch (e) {
    console.log("[Backtest] price fetch failed:", e);
  }
  priceCache = { at: Date.now(), map };
  return map;
}

let stepCache: { at: number; map: Record<string, number> } | null = null;

async function getQtyStep(symbol: string): Promise<number> {
  if (!stepCache || Date.now() - stepCache.at > 3_600_000) {
    const map: Record<string, number> = {};
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", {
        headers: { "User-Agent": "pompay-server" },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          symbols: { symbol: string; filters: { filterType: string; stepSize?: string }[] }[];
        };
        for (const s of data.symbols) {
          const f = s.filters.find((x) => x.filterType === "LOT_SIZE");
          if (f?.stepSize) map[s.symbol] = parseFloat(f.stepSize);
        }
      }
    } catch (e) {
      console.log("[Backtest] exchangeInfo fetch failed:", e);
    }
    stepCache = { at: Date.now(), map };
  }
  return stepCache.map[symbol] ?? 0.001;
}

async function roundQty(symbol: string, qty: number): Promise<number> {
  const step = await getQtyStep(symbol);
  if (!(step > 0)) return Math.floor(qty * 1000) / 1000;
  return Math.floor(qty / step) * step;
}

// ---------------------------------------------------------------------------
// Binance SIGNED requests (real mode only — keys stay on THIS user-owned server)
// ---------------------------------------------------------------------------

const FUTURES = "https://fapi.binance.com";

function sign(query: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signed(
  keys: { apiKey: string; apiSecret: string },
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params: Record<string, string | number>
): Promise<unknown> {
  const all: Record<string, string | number> = { ...params, timestamp: Date.now(), recvWindow: 10000 };
  const qs = Object.entries(all)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const url = `${FUTURES}${path}?${qs}&signature=${sign(qs, keys.apiSecret)}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": keys.apiKey, "User-Agent": "pompay-server" },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data?.msg ?? `HTTP ${res.status}`));
  }
  return data;
}

async function placeMarket(
  keys: { apiKey: string; apiSecret: string },
  symbol: string,
  side: "long" | "short",
  qty: number
): Promise<void> {
  await signed(keys, "POST", "/fapi/v1/order", {
    symbol,
    side: side === "long" ? "BUY" : "SELL",
    type: "MARKET",
    quantity: qty,
  });
}

async function placeStop(
  keys: { apiKey: string; apiSecret: string },
  symbol: string,
  posSide: "long" | "short",
  qty: number,
  stopPrice: number,
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET"
): Promise<void> {
  await signed(keys, "POST", "/fapi/v1/order", {
    symbol,
    side: posSide === "long" ? "SELL" : "BUY",
    type,
    stopPrice: Number(stopPrice.toFixed(6)),
    closePosition: "true",
    workingType: "MARK_PRICE",
  });
}

async function cancelSymbolOrders(
  keys: { apiKey: string; apiSecret: string },
  symbol: string,
  kind: "STOP_MARKET" | "TAKE_PROFIT_MARKET"
): Promise<void> {
  try {
    const orders = (await signed(keys, "GET", "/fapi/v1/openOrders", { symbol })) as {
      type: string;
      orderId: number;
    }[];
    for (const o of orders) {
      if (o.type === kind) {
        await signed(keys, "DELETE", "/fapi/v1/order", { symbol, orderId: o.orderId });
      }
    }
  } catch {
    // no open orders of that kind → fine
  }
}

async function setLeverage(keys: { apiKey: string; apiSecret: string }, symbol: string, leverage: number): Promise<void> {
  try {
    await signed(keys, "POST", "/fapi/v1/leverage", { symbol, leverage: Math.max(1, Math.round(leverage)) });
  } catch {
    // already set / not needed
  }
}

async function getLivePositions(
  keys: { apiKey: string; apiSecret: string }
): Promise<{ symbol: string; positionAmt: string; markPrice: string }[]> {
  return (await signed(keys, "GET", "/fapi/v2/positionRisk", {})) as {
    symbol: string;
    positionAmt: string;
    markPrice: string;
  }[];
}

async function closeRealPosition(
  keys: { apiKey: string; apiSecret: string },
  symbol: string,
  side: "long" | "short",
  qty: number
): Promise<void> {
  await signed(keys, "POST", "/fapi/v1/order", {
    symbol,
    side: side === "long" ? "SELL" : "BUY",
    type: "MARKET",
    quantity: qty,
    reduceOnly: "true",
  });
}

// ---------------------------------------------------------------------------
// Trading math (identical to the app's autoTradingEngine)
// v1.5.3 — SL with leverage: price distance = loss% ÷ leverage so the
// ACCOUNT loss is EXACTLY maxLossPercent («۳٪ با لوریج ۵ = ۱۵٪»).
// ---------------------------------------------------------------------------

function computeStopTake(
  side: "long" | "short",
  entry: number,
  maxLossPercent: number,
  rewardRatio: number,
  leverage = 1
): { stopPrice: number; takePrice: number } {
  const lev = Math.max(1, leverage);
  const lossPct = Math.max(0.5, Math.min(90, maxLossPercent));
  const risk = (lossPct / 100 / lev) * entry;
  const stopPrice = side === "long" ? entry - risk : entry + risk;
  const takePrice =
    side === "long" ? entry + risk * Math.max(0.5, rewardRatio) : entry - risk * Math.max(0.5, rewardRatio);
  return { stopPrice, takePrice };
}

/** v1.5.3 — سود لحظه‌ای به ٪ مارجینِ باقی‌مانده. */
function marginPnlPctOf(p: Pick<BtPosition, "side" | "entryPrice" | "qty" | "leverage">, px: number): number {
  const dir = p.side === "long" ? 1 : -1;
  const pnl = (px - p.entryPrice) * dir * p.qty;
  const margin = (p.qty * p.entryPrice) / Math.max(1, p.leverage ?? 1);
  return margin > 0 ? (pnl / margin) * 100 : 0;
}

interface TrailingUpdate {
  newStop: number;
  armed: boolean;
  highWater: number;
  lowWater: number;
  changed: boolean;
}

// v1.5.3 — تریلینگ جدید (طبق مشخصات کاربر):
//  ۱) ۱٪ حرکت قیمت به سود → ریسک‌فری (استاپ = ورود + کارمزد)
//  ۲) بعد از آن استاپ روی نصفِ بیشترین سود می‌نشیند و فقط بالا می‌رود
function computeTrailing(
  p: Pick<BtPosition, "side" | "entryPrice" | "stopPrice" | "initialStopPrice" | "highWater" | "lowWater" | "trailArmed">,
  px: number,
  t: { enabled: boolean; activationRatio: number; trailRatio: number }
): TrailingUpdate {
  const highWater = Math.max(p.highWater ?? p.entryPrice, px);
  const lowWater = Math.min(p.lowWater ?? p.entryPrice, px);
  if (!t.enabled) {
    return { newStop: p.stopPrice, armed: p.trailArmed ?? false, highWater, lowWater, changed: false };
  }
  const long = p.side === "long";
  const best = long ? highWater : lowWater;
  const favorable = long ? best - p.entryPrice : p.entryPrice - best;
  const spotPct = favorable / p.entryPrice;
  const armed = (p.trailArmed ?? false) || spotPct >= RISK_FREE_SPOT_PCT;
  let candidate = long ? -Infinity : Infinity;
  if (armed && favorable > 0) {
    const feeFloor = long ? p.entryPrice * (1 + FEE_ROUNDTRIP) : p.entryPrice * (1 - FEE_ROUNDTRIP);
    const lockPrice = p.entryPrice + (long ? 1 : -1) * favorable * LOCK_RATIO;
    candidate = long ? Math.max(feeFloor, lockPrice) : Math.min(feeFloor, lockPrice);
  }
  if (!Number.isFinite(candidate)) {
    return { newStop: p.stopPrice, armed, highWater, lowWater, changed: false };
  }
  const newStop = long ? Math.max(p.stopPrice, candidate) : Math.min(p.stopPrice, candidate);
  const changed = newStop !== p.stopPrice;
  return { newStop, armed, highWater, lowWater, changed };
}

function aiCapitalSize(cfg: AutoCfg, daily: { realized: number }): { sizeUsd: number; pausedReason?: string } {
  if (!cfg.aiCapital.enabled) return { sizeUsd: cfg.positionSizeUsd };
  // anti-martingale (streak read by caller) is applied outside; here only the cap
  const capital = cfg.positionSizeUsd * Math.max(1, cfg.maxOpenPositions);
  const cap = (cfg.aiCapital.dailyLossLimitPercent / 100) * capital;
  if (cap > 0 && daily.realized <= -cap) {
    return {
      sizeUsd: cfg.positionSizeUsd,
      pausedReason: `مدیریت سرمایه هوشمند: سقف ضرر روزانه (${cfg.aiCapital.dailyLossLimitPercent}٪) پر شده — باز کردن پوزیشن جدید متوقف شد`,
    };
  }
  return { sizeUsd: cfg.positionSizeUsd };
}

// ---------------------------------------------------------------------------
// Whale mirror — Hyperliquid diff
// ---------------------------------------------------------------------------

async function fetchWhalePositions(address: string): Promise<{ coin: string; side: "long" | "short" }[] | null> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      assetPositions?: { position: { coin: string; szi: string; side: "long" | "short" } }[];
    }[];
    const state = Array.isArray(data) ? data[0] : (data as { assetPositions?: { position: { coin: string; szi: string; side: "long" | "short" } }[] } | undefined);
    const out: { coin: string; side: "long" | "short" }[] = [];
    for (const ap of state?.assetPositions ?? []) {
      const p = ap?.position;
      if (!p?.coin || !p.szi || parseFloat(p.szi) === 0) continue;
      out.push({ coin: p.coin, side: p.side === "short" ? "short" : "long" });
    }
    return out;
  } catch (e) {
    console.log("[Backtest] whale fetch failed:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Indicator signals — read the signal stores scanEngine already maintains
// ---------------------------------------------------------------------------

interface StoredSignal {
  id: string;
  symbol: string;
  action: "buy" | "sell";
  price: number;
  timeframe?: string;
  detectedAt: number;
  indicatorId?: string;
  indicatorName?: string;
}

const AUTO_TFS = ["15m", "30m", "1h", "4h", "1d"];

async function collectIndicatorSignals(
  indicators: AutoCfg["indicators"]
): Promise<{ symbol: string; action: "buy" | "sell"; price: number; detectedAt: number; indicatorName: string }[]> {
  if (!indicators.enabled || indicators.selections.length === 0) return [];
  const [hooks, gainz, customs] = await Promise.all([
    store.get<StoredSignal[]>("hookSignals"),
    store.get<StoredSignal[]>("gainzSignals"),
    store.get<StoredSignal[]>("customSignals"),
  ]);
  const out: { symbol: string; action: "buy" | "sell"; price: number; detectedAt: number; indicatorName: string }[] = [];
  const push = (sig: StoredSignal | undefined, id: string, name: string, fallbackTf: string) => {
    if (!sig) return;
    const sel = indicators.selections.find((s) => s.id === id);
    if (!sel) return;
    const tf = sig.timeframe && AUTO_TFS.includes(sig.timeframe) ? sig.timeframe : fallbackTf;
    if (sel.timeframes.length > 0 && !sel.timeframes.includes(tf)) return;
    out.push({ symbol: sig.symbol, action: sig.action, price: sig.price, detectedAt: sig.detectedAt, indicatorName: name });
  };
  for (const s of hooks ?? []) push(s, "builtin:hook", "هوک ریورسال", "1d");
  for (const s of gainz ?? []) push(s, "builtin:gainz", "GainzAlgo Pro", "1d");
  for (const s of customs ?? []) {
    if (s.indicatorId) push(s, s.indicatorId, s.indicatorName ?? "اندیکاتور دستی", "15m");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open / close (demo + real)
// ---------------------------------------------------------------------------

function pnlOf(p: BtPosition, price: number): number {
  const dir = p.side === "long" ? 1 : -1;
  return (price - p.entryPrice) * dir * p.qty;
}

async function openDemo(cfg: AutoCfg, st: StoredAutoConfig, symbol: string, side: "long" | "short", price: number, source: "whale" | "indicator", sourceLabel: string): Promise<boolean> {
  const state = await getState();
  if (state.demo.filter((p) => p.status === "open").length >= cfg.maxOpenPositions) return false;
  if (state.demo.some((p) => p.status === "open" && p.symbol === symbol && p.side === side)) return false;
  const gate = aiCapitalSize(cfg, st.daily);
  if (gate.pausedReason) {
    await appendLog("info", `${symbol}: ${gate.pausedReason}`);
    return false;
  }
  let sizeUsd = gate.sizeUsd;
  if (cfg.aiCapital.enabled && st.lossStreak > 0) {
    sizeUsd = sizeUsd * Math.max(0.25, Math.pow(0.75, Math.min(10, st.lossStreak)));
  }
  const { stopPrice, takePrice } = computeStopTake(side, price, cfg.maxLossPercent, cfg.rewardRatio, cfg.leverage);
  const qty = (sizeUsd * cfg.leverage) / price;
  const pos: BtPosition = {
    id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entryPrice: price,
    qty,
    sizeUsd,
    leverage: cfg.leverage,
    stopPrice,
    takePrice,
    openedAt: Date.now(),
    source,
    sourceLabel,
    status: "open",
    lastPrice: price,
    initialStopPrice: stopPrice,
    highWater: price,
    lowWater: price,
    trailArmed: false,
    strategyName: cfg.strategyLabel,
    partialsDone: 0,
  };
  state.demo.unshift(pos);
  await putState(state);
  st.daily = { ...st.daily, entries: st.daily.entries + 1 };
  await appendLog(
    "open",
    `دمو ${side === "long" ? "خرید" : "فروش"} ${symbol} @ ${price} (${sourceLabel}${cfg.strategyLabel ? ` • استراتژی ${cfg.strategyLabel}` : ""}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== cfg.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ""}`
  );
  await announce(
    `🤖 بک‌تست (دمو): ${side === "long" ? "🟢 خرید" : "🔴 فروش"} ${symbol}`,
    `ورود ${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)}\nمنبع: ${sourceLabel} • لوریج ${cfg.leverage}x${cfg.strategyLabel ? ` • استراتژی ${cfg.strategyLabel}` : ""}`
  );
  return true;
}

async function closeDemo(st: StoredAutoConfig, id: string, price: number, reason: BtPosition["closeReason"]): Promise<boolean> {
  const state = await getState();
  const idx = state.demo.findIndex((p) => p.id === id && p.status === "open");
  if (idx < 0) return false;
  const p = state.demo[idx];
  const pnl = pnlOf(p, price);
  state.demo[idx] = { ...p, status: "closed", closedAt: Date.now(), closeReason: reason, realizedPnl: pnl, lastPrice: price };
  await putState(state);
  st.daily = { ...st.daily, realized: st.daily.realized + pnl };
  st.lossStreak = pnl < 0 ? Math.min(10, st.lossStreak + 1) : pnl > 0 ? 0 : st.lossStreak;
  await appendLog(
    "close",
    `بستن دمو ${p.symbol} (${reason === "stop" ? "استاپ" : reason === "take" ? "تیک‌پرافیت" : reason === "whale-close" ? "بستن نهنگ" : reason === "signal" ? "سیگنال" : "دستی"}): ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`
  );
  await announce(
    `🤖 بک‌تست (دمو): بستن ${p.symbol}`,
    `${reason === "stop" ? "استاپ" : reason === "take" ? "تیک‌پرافیت" : reason === "whale-close" ? "نهنگ بست" : reason === "partial" ? "برداشت سود (نصف حجم)" : "سیگنال"} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ""}`
  );
  return true;
}

// ---------------------------------------------------------------------------
// v1.5.3 — PARTIAL take-profit («وقتی معامله به ۲۵٪ یا ۵۰٪ رسید نصف معامله
// را ببنده — ربات مدیریت سرمایه کنه که سودی از دست نره»)
// ---------------------------------------------------------------------------

/** بستن نصف (یا کسر دلخواه) یک پوزیشن دمو — بخش بسته‌شده به‌عنوان رکورد
 *  «بسته» با دلیل partial ثبت می‌شود (در تاریخچه/PnL اپ دیده می‌شود). */
async function partialCloseDemo(st: StoredAutoConfig, id: string, price: number, fraction: number, reason: "partial" | "partial-manual"): Promise<boolean> {
  const state = await getState();
  const idx = state.demo.findIndex((p) => p.id === id && p.status === "open");
  if (idx < 0) return false;
  const p = state.demo[idx];
  const dir = p.side === "long" ? 1 : -1;
  const closedQty = p.qty * Math.max(0.1, Math.min(0.9, fraction));
  const remainingQty = p.qty - closedQty;
  if (remainingQty * price < 1) {
    return closeDemo(st, id, price, reason === "partial" ? "take" : "manual");
  }
  const pnl = (price - p.entryPrice) * dir * closedQty;
  state.demo[idx] = { ...p, qty: remainingQty, partialsDone: (p.partialsDone ?? 0) + 1, lastPrice: price };
  const partialRecord: BtPosition = {
    ...p,
    id: `${p.id}-p${(p.partialsDone ?? 0) + 1}`,
    qty: closedQty,
    status: "closed",
    closedAt: Date.now(),
    closeReason: reason,
    realizedPnl: pnl,
    lastPrice: price,
    partialsDone: undefined,
  };
  state.demo.splice(idx + 1, 0, partialRecord);
  await putState(state);
  const label = reason === "partial" ? "برداشت سود پله‌ای (نصف حجم)" : "بستن دستی نصف حجم";
  await appendLog("close", `${label} — ${p.symbol}: ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`);
  await announce(
    `🤖 بک‌تست (دمو): نصف حجم ${p.symbol} بسته شد`,
    `${label} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ""}`
  );
  return true;
}

/** بستن نصف یک پوزیشن واقعی — سفارش reduceOnly بدون لغو SL/TP
 *  (استاپ/تیکی با closePosition:true روی حجم باقی‌مانده محافظت می‌کنند). */
async function partialCloseReal(
  keys: { apiKey: string; apiSecret: string },
  pos: BtPosition,
  price: number,
  reason: "partial" | "partial-manual"
): Promise<boolean> {
  const closedQty = pos.qty * Math.max(0.1, Math.min(0.9, PARTIAL_FRACTION));
  if (!(closedQty > 0)) return false;
  try {
    await closeRealPosition(keys, `${pos.symbol}USDT`, pos.side, await roundQty(`${pos.symbol}USDT`, closedQty));
  } catch (e) {
    await appendLog("error", `بستن نصف ${pos.symbol}: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
    return false;
  }
  const state = await getState();
  const idx = state.real.findIndex((p) => p.id === pos.id && p.status === "open");
  if (idx < 0) return false;
  const p = state.real[idx];
  const remainingQty = p.qty - closedQty;
  const dir = p.side === "long" ? 1 : -1;
  const pnl = (price - p.entryPrice) * dir * closedQty;
  state.real[idx] = { ...p, qty: remainingQty, partialsDone: (p.partialsDone ?? 0) + 1, lastPrice: price };
  const partialRecord: BtPosition = {
    ...p,
    id: `${p.id}-p${(p.partialsDone ?? 0) + 1}`,
    qty: closedQty,
    status: "closed",
    closedAt: Date.now(),
    closeReason: reason,
    realizedPnl: pnl,
    lastPrice: price,
    partialsDone: undefined,
  };
  state.real.splice(idx + 1, 0, partialRecord);
  await putState(state);
  const label = reason === "partial" ? "برداشت سود پله‌ای (نصف حجم)" : "بستن دستی نصف حجم";
  await appendLog("close", `${label} — واقعی ${pos.symbol}: ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)} تقریبی`);
  await announce(
    `🤖 بک‌تست (واقعی): نصف حجم ${pos.symbol} بسته شد`,
    `${label} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} ~$${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ""}`
  );
  return true;
}

async function markDemo(cfg: AutoCfg, st: StoredAutoConfig, prices: Record<string, number>): Promise<void> {
  const state = await getState();
  let dirty = false;
  for (let i = 0; i < state.demo.length; i++) {
    let p = state.demo[i];
    if (p.status !== "open") continue;
    const px = prices[`${p.symbol}USDT`];
    if (!px || !(px > 0)) continue;
    state.demo[i].lastPrice = px;
    dirty = true;
    // v1.5.3 — برداشت سود پله‌ای (۲۵٪/۵۰٪ سود حساب)؛ سپس تریل روی حجم
    // باقی‌مانده در همان چرخه اعمال می‌شود.
    const marginPct = marginPnlPctOf(state.demo[i], px);
    const done = state.demo[i].partialsDone ?? 0;
    if (done < PARTIAL_TAKE_PNL_PCTS.length && marginPct >= PARTIAL_TAKE_PNL_PCTS[done]) {
      await putState(state);
      await partialCloseDemo(st, p.id, px, PARTIAL_FRACTION, "partial");
      const fresh = await getState();
      state.demo = fresh.demo;
      const fi = state.demo.findIndex((x) => x.id === p.id && x.status === "open");
      if (fi < 0) {
        dirty = false;
        continue;
      }
      i = fi;
      p = state.demo[fi];
      dirty = false;
    }
    const tr = computeTrailing(state.demo[i], px, cfg.trailing);
    state.demo[i].stopPrice = tr.newStop;
    state.demo[i].highWater = tr.highWater;
    state.demo[i].lowWater = tr.lowWater;
    state.demo[i].trailArmed = tr.armed;
    if (tr.changed) {
      await appendLog("info", `تریلینگ استاپ ${p.symbol} → ${tr.newStop.toFixed(4)}${tr.armed ? " (فعال)" : ""}`);
    }
    const hitStop = p.side === "long" ? px <= tr.newStop : px >= tr.newStop;
    const hitTake = p.side === "long" ? px >= p.takePrice : px <= p.takePrice;
    if (hitStop || hitTake) {
      const exit = hitStop ? tr.newStop : p.takePrice;
      const pnl = (exit - p.entryPrice) * (p.side === "long" ? 1 : -1) * p.qty;
      state.demo[i] = {
        ...state.demo[i],
        status: "closed",
        closedAt: Date.now(),
        closeReason: hitStop ? "stop" : "take",
        realizedPnl: pnl,
        lastPrice: px,
      };
      st.daily = { ...st.daily, realized: st.daily.realized + pnl };
      st.lossStreak = pnl < 0 ? Math.min(10, st.lossStreak + 1) : pnl > 0 ? 0 : st.lossStreak;
      await appendLog(
        "close",
        `بستن دمو ${p.symbol} (${hitStop ? "استاپ‌لاس" : "تیک‌پرافیت"}${hitStop && pnl >= 0 ? " — ریسک‌فری" : ""}): ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`
      );
      await announce(
        `🤖 بک‌تست (دمو): بستن ${p.symbol}`,
        `${hitStop ? "استاپ" : "تیک‌پرافیت"}${hitStop && pnl >= 0 ? " (ریسک‌فری)" : ""} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ""}`
      );
    }
  }
  if (dirty) await putState(state);
}

async function openReal(cfg: AutoCfg, st: StoredAutoConfig, symbol: string, side: "long" | "short", price: number, sourceLabel: string): Promise<boolean> {
  const keys = cfg.binanceKeys;
  if (!keys) return false;
  const state = await getState();
  if (state.real.filter((p) => p.status === "open").length >= cfg.maxOpenPositions) return false;
  if (state.real.some((p) => p.status === "open" && p.symbol === symbol && p.side === side)) return false;
  const gate = aiCapitalSize(cfg, st.daily);
  if (gate.pausedReason) {
    await appendLog("info", `${symbol}: ${gate.pausedReason}`);
    return false;
  }
  let sizeUsd = gate.sizeUsd;
  if (cfg.aiCapital.enabled && st.lossStreak > 0) {
    sizeUsd = sizeUsd * Math.max(0.25, Math.pow(0.75, Math.min(10, st.lossStreak)));
  }
  const { stopPrice, takePrice } = computeStopTake(side, price, cfg.maxLossPercent, cfg.rewardRatio, cfg.leverage);
  const symbolU = `${symbol}USDT`;
  const rawQty = (sizeUsd * cfg.leverage) / price;
  const qty = await roundQty(symbolU, rawQty);
  if (!(qty > 0)) {
    await appendLog("error", `واقعی ${symbol}: حجم محاسبه‌شده صفر شد (قیمت ${price})`);
    return false;
  }
  await setLeverage(keys, symbolU, cfg.leverage);
  await placeMarket(keys, symbolU, side, qty);
  await placeStop(keys, symbolU, side, qty, stopPrice, "STOP_MARKET");
  await placeStop(keys, symbolU, side, qty, takePrice, "TAKE_PROFIT_MARKET");
  const pos: BtPosition = {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entryPrice: price,
    qty,
    sizeUsd,
    leverage: cfg.leverage,
    stopPrice,
    takePrice,
    openedAt: Date.now(),
    source: sourceLabel.includes("نهنگ") ? "whale" : "indicator",
    sourceLabel,
    status: "open",
    lastPrice: price,
    initialStopPrice: stopPrice,
    highWater: price,
    lowWater: price,
    trailArmed: false,
    strategyName: cfg.strategyLabel,
    partialsDone: 0,
  };
  state.real.unshift(pos);
  await putState(state);
  st.daily = { ...st.daily, entries: st.daily.entries + 1 };
  await appendLog(
    "open",
    `واقعی ${side === "long" ? "خرید" : "فروش"} ${symbol} @ ~${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}`
  );
  await announce(
    `🤖 بک‌تست (واقعی): ${side === "long" ? "🟢 خرید" : "🔴 فروش"} ${symbol}`,
    `ورود ~${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)}\nمنبع: ${sourceLabel} • لوریج ${cfg.leverage}x`
  );
  return true;
}

async function closeReal(st: StoredAutoConfig, keys: { apiKey: string; apiSecret: string }, symbol: string, side: "long" | "short", qty: number, reason: string, reasonKind: BtPosition["closeReason"]): Promise<void> {
  await closeRealPosition(keys, `${symbol}USDT`, side, qty);
  const state = await getState();
  const idx = state.real.findIndex((p) => p.status === "open" && p.symbol === symbol && p.side === side);
  if (idx >= 0) {
    const p = state.real[idx];
    const pnl = pnlOf(p, p.lastPrice);
    state.real[idx] = { ...p, status: "closed", closedAt: Date.now(), closeReason: reasonKind, realizedPnl: pnl };
    await putState(state);
    st.daily = { ...st.daily, realized: st.daily.realized + pnl };
    st.lossStreak = pnl < 0 ? Math.min(10, st.lossStreak + 1) : pnl > 0 ? 0 : st.lossStreak;
    await appendLog("close", `بستن واقعی ${symbol} (${reason}): ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)} تقریبی`);
    await announce(
      `🤖 بک‌تست (واقعی): بستن ${symbol}`,
      `${reason} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} ~$${Math.abs(pnl).toFixed(2)}`
    );
  }
}

async function manageReal(cfg: AutoCfg, st: StoredAutoConfig): Promise<void> {
  const keys = cfg.binanceKeys;
  if (!keys) return;
  const state = await getState();
  const openTracked = state.real.filter((p) => p.status === "open");
  if (openTracked.length === 0) return;
  let live: { symbol: string; positionAmt: string; markPrice: string }[];
  try {
    live = await getLivePositions(keys);
  } catch (e) {
    await appendLog("error", `پوزیشن‌های واقعی: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
    return;
  }
  const liveMap = new Map(live.map((p) => [p.symbol, p]));
  let dirty = false;
  for (let i = 0; i < state.real.length; i++) {
    let p = state.real[i];
    if (p.status !== "open") continue;
    const lp = liveMap.get(`${p.symbol}USDT`);
    const amt = lp ? parseFloat(lp.positionAmt) : 0;
    if (!lp || amt === 0) {
      // closed on the exchange (SL/TP hit) — book approximate PnL
      const pnl = pnlOf(p, p.lastPrice);
      state.real[i] = { ...p, status: "closed", closedAt: Date.now(), closeReason: "take", realizedPnl: pnl };
      dirty = true;
      st.daily = { ...st.daily, realized: st.daily.realized + pnl };
      st.lossStreak = pnl < 0 ? Math.min(10, st.lossStreak + 1) : pnl > 0 ? 0 : st.lossStreak;
      await appendLog("close", `بستن واقعی ${p.symbol} (روی صرافی): ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)} تقریبی`);
      await announce(
        `🤖 بک‌تست (واقعی): بستن ${p.symbol}`,
        `بسته شد روی صرافی (استاپ/تیک‌پرافیت) • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} ~$${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ""}`
      );
      continue;
    }
    const mark = parseFloat(lp.markPrice) || p.lastPrice;
    state.real[i].lastPrice = mark;
    const liveQty = Math.abs(amt);
    if (liveQty > 0) state.real[i].qty = liveQty;
    dirty = true;
    // v1.5.3 — برداشت سود پله‌ای روی پوزیشن واقعی (۲۵٪/۵۰٪ سود حساب)؛
    // سپس تریل روی حجم باقی‌مانده در همان چرخه اعمال می‌شود.
    const marginPct = marginPnlPctOf(state.real[i], mark);
    const done = state.real[i].partialsDone ?? 0;
    if (done < PARTIAL_TAKE_PNL_PCTS.length && marginPct >= PARTIAL_TAKE_PNL_PCTS[done]) {
      await putState(state);
      await partialCloseReal(keys, state.real[i], mark, "partial");
      const fresh = await getState();
      state.real = fresh.real;
      const fi = state.real.findIndex((x) => x.id === p.id && x.status === "open");
      if (fi < 0) {
        dirty = false;
        continue;
      }
      i = fi;
      p = state.real[fi];
      dirty = false;
    }
    const tr = computeTrailing(state.real[i], mark, cfg.trailing);
    state.real[i].stopPrice = tr.newStop;
    state.real[i].highWater = tr.highWater;
    state.real[i].lowWater = tr.lowWater;
    state.real[i].trailArmed = tr.armed;
    dirty = true;
    if (tr.changed) {
      try {
        await cancelSymbolOrders(keys, `${p.symbol}USDT`, "STOP_MARKET");
        await placeStop(keys, `${p.symbol}USDT`, p.side, liveQty > 0 ? liveQty : p.qty, tr.newStop, "STOP_MARKET");
        await appendLog("info", `تریلینگ استاپ واقعی ${p.symbol} → ${tr.newStop.toFixed(4)}`);
      } catch (e) {
        await appendLog("error", `تریلینگ ${p.symbol}: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
      }
    }
  }
  if (dirty) await putState(state);
}

// ---------------------------------------------------------------------------
// THE CYCLE
// ---------------------------------------------------------------------------

let cycleRunning = false;
let engineTimer: NodeJS.Timeout | null = null;

export async function runBacktestCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const st = await getConfig();
    if (!st || !st.cfg.enabled) return;
    const cfg = st.cfg;
    // daily rollover
    if (st.daily.date !== todayKey()) {
      st.daily = { date: todayKey(), realized: 0, entries: 0 };
    }
    const prices = await getPrices();

    // 1) demo MTM + trailing + SL/TP
    try {
      await markDemo(cfg, st, prices);
    } catch (e) {
      console.log("[Backtest] demo MTM failed:", e);
    }

    // 2) real positions management
    if (cfg.mode === "real" && cfg.binanceKeys) {
      try {
        await manageReal(cfg, st);
      } catch (e) {
        console.log("[Backtest] real manage failed:", e);
      }
    }

    // 3) whale mirror
    if (cfg.whale.enabled && cfg.whale.address) {
      try {
        const next = await fetchWhalePositions(cfg.whale.address);
        if (next) {
          const key = (p: { coin: string; side: string }) => `${p.coin}:${p.side}`;
          const prevMap = new Map(st.whaleSnapshot.map((p) => [key(p), p]));
          const nextMap = new Map(next.map((p) => [key(p), p]));
          for (const [k, p] of nextMap) {
            if (prevMap.has(k)) continue;
            const price = prices[`${p.coin}USDT`] ?? 0;
            if (!(price > 0)) continue;
            const side = cfg.whale.mirrorSide ? p.side : p.side === "long" ? "short" : "long";
            const label = `نهنگ ${cfg.whale.label || cfg.whale.address.slice(0, 8)}`;
            if (cfg.mode === "real" && cfg.binanceKeys) {
              try {
                await openReal(cfg, st, p.coin, side, price, label);
              } catch (e) {
                await appendLog("error", `واقعی ${p.coin}: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
              }
            } else {
              await openDemo(cfg, st, p.coin, side, price, "whale", label);
            }
          }
          for (const [k, p] of prevMap) {
            if (nextMap.has(k)) continue;
            if (cfg.mode === "real" && cfg.binanceKeys) {
              const side = cfg.whale.mirrorSide ? p.side : p.side === "long" ? "short" : "long";
              const state = await getState();
              const open = state.real.find((x) => x.status === "open" && x.symbol === p.coin && x.side === side);
              try {
                if (open) {
                  await closeReal(st, cfg.binanceKeys, p.coin, side, open.qty, "کپی بستن نهنگ", "whale-close");
                }
              } catch (e) {
                await appendLog("error", `واقعی ${p.coin}: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
              }
            } else {
              const state = await getState();
              const open = state.demo.filter((x) => x.status === "open" && x.symbol === p.coin && x.source === "whale");
              for (const o of open) {
                const px = prices[`${o.symbol}USDT`] ?? o.lastPrice;
                await closeDemo(st, o.id, px, "whale-close");
              }
            }
          }
          st.whaleSnapshot = next;
        }
      } catch (e) {
        console.log("[Backtest] whale mirror failed:", e);
      }
    }

    // 4) indicator signals (freshness cursor so each signal trades once)
    if (cfg.indicators.enabled && cfg.indicators.selections.length > 0) {
      try {
        const fresh = (await collectIndicatorSignals(cfg.indicators)).filter((s) => s.detectedAt > st.lastSignalAt);
        for (const s of fresh) {
          const coin = s.symbol.replace(/USDT$/i, "").toUpperCase();
          const price = s.price > 0 ? s.price : prices[`${coin}USDT`] ?? 0;
          if (!(price > 0)) continue;
          const side: "long" | "short" = s.action === "buy" ? "long" : "short";
          const label = `اندیکاتور ${s.indicatorName}`;
          if (cfg.mode === "real" && cfg.binanceKeys) {
            try {
              await openReal(cfg, st, coin, side, price, label);
            } catch (e) {
              await appendLog("error", `واقعی ${coin}: ${e instanceof Error ? e.message.slice(0, 60) : "خطا"}`);
            }
          } else {
            // opposite signal closes same-coin indicator positions first
            const state = await getState();
            const opposite = state.demo.filter(
              (p) => p.status === "open" && p.symbol === coin && p.source === "indicator" && p.side !== side
            );
            for (const o of opposite) {
              await closeDemo(st, o.id, price, "signal");
            }
            await openDemo(cfg, st, coin, side, price, "indicator", label);
          }
        }
        const maxAt = fresh.reduce((m, s) => Math.max(m, s.detectedAt), 0);
        if (maxAt > st.lastSignalAt) st.lastSignalAt = maxAt;
      } catch (e) {
        console.log("[Backtest] indicator signals failed:", e);
      }
    }

    st.updatedAt = Date.now();
    await putConfig(st);
    const state = await getState();
    await putState({ ...state, lastCycleAt: Date.now() });
  } catch (e) {
    console.log("[Backtest] cycle failed:", e);
  } finally {
    cycleRunning = false;
  }
}

/** Boot the 24/7 engine — call once from index.ts. */
export function startBacktestEngine(): void {
  if (engineTimer) return;
  engineTimer = setInterval(() => void runBacktestCycle(), CYCLE_MS);
  engineTimer.unref?.();
  // boot catch-up (40s grace so the rest of the server settles first)
  setTimeout(() => void runBacktestCycle(), 40_000).unref?.();
  console.log("[Backtest] 24/7 engine started (60s cycle)");
}

// ---------------------------------------------------------------------------
// HTTP handlers (called from index.ts)
// ---------------------------------------------------------------------------

export async function handleAutoTradeConfig(body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
  const b = body as {
    secret?: string;
    config?: Partial<AutoCfg> & {
      state?: {
        demoPositions?: unknown[];
        realPositions?: unknown[];
        logs?: unknown[];
      };
    };
    reset?: boolean;
  };
  const serverCfg = await store.get<{ secret?: string }>("config");
  if (!serverCfg?.secret || !b?.secret || serverCfg.secret !== b.secret) {
    return { status: 403, payload: { ok: false, error: "راز نصب مطابقت ندارد — از همان گوشی که پیکربندی سرور را ثبت کرده فعال کنید" } };
  }
  const c = b.config ?? {};
  const prev = await getConfig();
  const cfg: AutoCfg = {
    enabled: Boolean(c.enabled),
    mode: c.mode === "real" ? "real" : "demo",
    whale: {
      enabled: Boolean(c.whale?.enabled),
      address: String(c.whale?.address ?? ""),
      label: String(c.whale?.label ?? ""),
      mirrorSide: c.whale?.mirrorSide !== false,
    },
    indicators: {
      enabled: Boolean(c.indicators?.enabled),
      selections: Array.isArray(c.indicators?.selections)
        ? (c.indicators!.selections as { id: string; timeframes: string[] }[]).map((s) => ({
            id: String(s.id ?? ""),
            timeframes: Array.isArray(s.timeframes) ? s.timeframes.map(String) : [],
          }))
        : [],
    },
    leverage: Math.max(1, Math.min(125, Number(c.leverage ?? 5) || 5)),
    positionSizeUsd: Math.max(5, Number(c.positionSizeUsd ?? 50) || 50),
    maxLossPercent: Math.max(0.5, Math.min(90, Number(c.maxLossPercent ?? 5) || 5)),
    rewardRatio: Math.max(0.5, Math.min(20, Number(c.rewardRatio ?? 2) || 2)),
    maxOpenPositions: Math.max(1, Math.min(100, Number(c.maxOpenPositions ?? 3) || 3)),
    trailing: {
      enabled: c.trailing?.enabled !== false,
      activationRatio: Number(c.trailing?.activationRatio ?? 0.5) || 0.5,
      trailRatio: Number(c.trailing?.trailRatio ?? 0.5) || 0.5,
    },
    aiCapital: {
      enabled: c.aiCapital?.enabled !== false,
      dailyLossLimitPercent: Math.max(0.5, Math.min(50, Number(c.aiCapital?.dailyLossLimitPercent ?? 3) || 3)),
    },
    initialCapitalUsd: Math.max(1, Number(c.initialCapitalUsd ?? 1000) || 1000),
    // v1.5.3 — استراتژی فعال (برچسب پوزیشن‌ها در تاریخچه)
    strategyLabel: c.strategyLabel ? String(c.strategyLabel) : undefined,
    // v1.5.4 — توکن تلگرام اپ (اعلان‌های ۲۴/۷ بدون ربات جداگانه).
    // اگر این push توکن نداشت، قبلی حفظ می‌شود (فراخوانی‌های قدیمی/سایر کلاینت‌ها
    // نباید اتصال تلگرام را قطع کنند).
    telegram:
      c.telegram && String(c.telegram.botToken ?? "").length > 10 && String(c.telegram.chatId ?? "").length > 0
        ? { botToken: String(c.telegram.botToken), chatId: String(c.telegram.chatId) }
        : prev?.cfg.telegram,
    binanceKeys:
      c.binanceKeys && String(c.binanceKeys.apiKey ?? "").length > 0
        ? { apiKey: String(c.binanceKeys.apiKey), apiSecret: String(c.binanceKeys.apiSecret ?? "") }
        : undefined,
  };
  const st: StoredAutoConfig = {
    cfg,
    whaleSnapshot: cfg.mode === (prev?.cfg.mode ?? "demo") ? (prev?.whaleSnapshot ?? []) : [],
    lastSignalAt: cfg.mode === (prev?.cfg.mode ?? "demo") ? (prev?.lastSignalAt ?? Date.now()) : Date.now(),
    daily: prev && prev.daily.date === todayKey() ? prev.daily : { date: todayKey(), realized: 0, entries: 0 },
    lossStreak: prev?.lossStreak ?? 0,
    updatedAt: Date.now(),
  };

  // v1.5.4 — seed: وضعیت بک‌تست از خود اپ منتقل می‌شود تا سرور از همان‌جا
  // ادامه دهد («روشن کردن سوییچ تلگرام همه‌چیز را پاک می‌کرد» — حالا تاریخچه
  // و پوزیشن‌ها همان لحظه روی سرور هست و sync اپ هیچ‌وقت چیزهایی را پاک نمی‌کند).
  // فقط وقتی state سرور «دختر/خام» است seed می‌کنیم (نه روی state فعال سرور).
  const cur = await getState();
  const virginState = cur.demo.length === 0 && cur.real.length === 0 && cur.logs.length === 0 && cur.lastCycleAt === null;
  if (!b.reset && virginState && b.config?.state) {
    const seedDemo = sanitizePositions(b.config.state.demoPositions);
    const seedReal = sanitizePositions(b.config.state.realPositions);
    const seedLogs = sanitizeLogs(b.config.state.logs);
    if (seedDemo.length + seedReal.length + seedLogs.length > 0) {
      await putState({ demo: seedDemo, real: seedReal, logs: seedLogs, lastCycleAt: null });
      if (cfg.enabled) {
        await appendLog(
          "info",
          `وضعیت بک‌تست از برنامه منتقل شد (${(seedDemo.length + seedReal.length).toLocaleString("fa-IR")} پوزیشن) — سرور همین‌جا ادامه می‌دهد`
        );
      }
    }
  }

  await putConfig(st);

  // v1.5.3 — «ریست کامل دمو»: همه‌چیز (حتی تاریخچه) پاک شود
  if (b.reset) {
    await putState({ demo: [], real: [], logs: [], lastCycleAt: null });
    st.whaleSnapshot = [];
    st.lastSignalAt = Date.now();
    st.daily = { date: todayKey(), realized: 0, entries: 0 };
    st.lossStreak = 0;
    await putConfig(st);
    await appendLog("info", "ریست کامل بک‌تست انجام شد — همه‌چیز از صفر شروع می‌شود (حتی تاریخچه پاک شد)");
    if (cfg.enabled) {
      await announce(
        "♻️ ریست کامل بک‌تست",
        `همه پوزیشن‌ها، تاریخچه و آمار پاک شد و ربات با تنظیمات فعلی از صفر شروع می‌کند.\nحالت: ${cfg.mode === "real" ? "واقعی" : "دمو"} • استراتژی: ${cfg.strategyLabel ?? "—"}`
      );
      void runBacktestCycle();
    }
    return { status: 200, payload: { ok: true, enabled: cfg.enabled, mode: cfg.mode, reset: true, telegramConfigured: !!cfg.telegram } };
  }

  if (cfg.enabled) {
    // v1.5.3 — ری‌استارت: لاگ قدیمی «متوقف شد» حذف می‌شود تا دیگر به‌عنوان
    // خطا دیده نشود («ربات را استپ و مجدد شروع کردم می‌زنه متوقف شد»).
    await dropStoppedLogs();
    const wasOff = prev ? !prev.cfg.enabled : true;
    await appendLog(
      "info",
      wasOff
        ? "ربات بک‌تست روی سرور فعال شد — اعلام‌ها به تلگرام می‌روند"
        : "ربات بک‌تست با تنظیمات جدید دوباره فعال شد"
    );
    // v1.5.3 — اعلام شروع/ری‌استارت با خلاصه تنظیمات (کاربر بلافاصله در
    // تلگرام می‌بیند که ربات روی سرور روشن شده — علت سکوت قبلی معلوم می‌شود)
    await announce(
      wasOff ? "🚀 ربات بک‌تست روی سرور فعال شد (۲۴/۷)" : "🔄 ربات بک‌تست با تنظیمات جدید دوباره فعال شد",
      `حالت: ${cfg.mode === "real" ? "واقعی 💰" : "دمو"} • استراتژی: ${cfg.strategyLabel ?? "—"}\n` +
        `لوریج ${cfg.leverage}x • حد ضرر ${cfg.maxLossPercent}٪ (= ضرر حساب ${Math.round(cfg.maxLossPercent * cfg.leverage)}٪) • R:R 1:${cfg.rewardRatio}\n` +
        `حجم $${cfg.positionSizeUsd} • حداکثر ${cfg.maxOpenPositions} پوزیشن • سرمایه اولیه $${cfg.initialCapitalUsd}\n` +
        `منبع: ${cfg.whale.enabled ? `نهنگ ${cfg.whale.label || cfg.whale.address.slice(0, 8)}` : ""}${cfg.whale.enabled && cfg.indicators.enabled ? " + " : ""}${cfg.indicators.enabled ? `اندیکاتورها (${cfg.indicators.selections.length} انتخاب)` : ""}\n` +
        `موتور ۲۴/۷ هر ۶۰ ثانیه چرخه می‌زند — باز/بسته شدن پوزیشن‌ها همین‌جا اعلام می‌شود.`
    );
    // immediate cycle so the user sees action right away
    void runBacktestCycle();
  } else if (prev?.cfg.enabled) {
    // v1.5.3 — توقف: دیگر لاگ «متوقف شد» ثبت نمی‌شود (خطا به نظر می‌رسید)؛
    // فقط یک اعلام آرام به تلگرام می‌رود.
    await announce(
      "⏸ ربات بک‌تست متوقف شد",
      "ربات روی سرور خاموش شد — دوباره روشن کنید تا با تنظیمات تازه اجرا شود."
    );
    await appendLog("info", "ربات بک‌تست خاموش شد (توقف دستی — برای اجرای دوباره روشن کنید)");
  }
  return {
    status: 200,
    payload: { ok: true, enabled: cfg.enabled, mode: cfg.mode, telegramConfigured: !!cfg.telegram },
  };
}

export async function getAutoTradeStateFor(secret: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const serverCfg = await store.get<{ secret?: string; botToken?: string; chatId?: string }>("config");
  if (!serverCfg?.secret || !secret || serverCfg.secret !== secret) {
    return { status: 403, payload: { ok: false, error: "secret mismatch" } };
  }
  const st = await getConfig();
  const state = await getState();
  // v1.5.4 — آیا اعلان‌های تلگرام روی سرور تنظیم شده (توکن اپ یا ربات سرور)؟
  const telegramConfigured = !!(st?.cfg.telegram?.botToken || serverCfg?.botToken);
  return {
    status: 200,
    payload: {
      ok: true,
      enabled: st?.cfg.enabled ?? false,
      mode: st?.cfg.mode ?? "demo",
      strategyLabel: st?.cfg.strategyLabel ?? null,
      telegramConfigured,
      demoPositions: state.demo.slice(0, 200),
      realPositions: state.real.slice(0, 200),
      logs: state.logs.slice(0, 60),
      lastCycleAt: state.lastCycleAt ?? null,
      serverNow: Date.now(),
    },
  };
}
