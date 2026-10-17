// server/src/backtestEngine.ts
// v1.5.2 — 24/7 SERVER-SIDE backtest bot («اعلام تلگرام ۲۴/۷ برای بک‌تست»).
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
//   • Telegram        — every OPEN / CLOSE announced with PnL
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
  closeReason?: "stop" | "take" | "signal" | "whale-close" | "manual";
  closedAt?: number;
  realizedPnl?: number;
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
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
const FEE_ARM_MARGIN = 0.0015;
const LOG_MAX = 60;

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

async function announce(title: string, text: string): Promise<void> {
  const cfg = await store.get<{ botToken?: string; chatId?: string }>("config");
  if (!cfg?.botToken || !cfg.chatId) return;
  await sendTelegram({ botToken: cfg.botToken, chatId: cfg.chatId }, `<b>${title}</b>\n${text}`);
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
// ---------------------------------------------------------------------------

function computeStopTake(
  side: "long" | "short",
  entry: number,
  maxLossPercent: number,
  rewardRatio: number
): { stopPrice: number; takePrice: number } {
  const risk = (Math.max(0.5, Math.min(90, maxLossPercent)) / 100) * entry;
  const stopPrice = side === "long" ? entry - risk : entry + risk;
  const takePrice =
    side === "long" ? entry + risk * Math.max(0.5, rewardRatio) : entry - risk * Math.max(0.5, rewardRatio);
  return { stopPrice, takePrice };
}

interface TrailingUpdate {
  newStop: number;
  armed: boolean;
  highWater: number;
  lowWater: number;
  changed: boolean;
}

function computeTrailing(
  p: Pick<BtPosition, "side" | "entryPrice" | "stopPrice" | "initialStopPrice" | "highWater" | "lowWater" | "trailArmed">,
  px: number,
  t: { enabled: boolean; activationRatio: number; trailRatio: number }
): TrailingUpdate {
  const initialStop = p.initialStopPrice ?? p.stopPrice;
  const risk = Math.abs(p.entryPrice - initialStop);
  const highWater = Math.max(p.highWater ?? p.entryPrice, px);
  const lowWater = Math.min(p.lowWater ?? p.entryPrice, px);
  if (!t.enabled || !(risk > 0)) {
    return { newStop: p.stopPrice, armed: p.trailArmed ?? false, highWater, lowWater, changed: false };
  }
  const long = p.side === "long";
  const best = long ? highWater : lowWater;
  const favorable = long ? best - p.entryPrice : p.entryPrice - best;
  const armed = (p.trailArmed ?? false) || favorable >= t.activationRatio * risk;
  let candidate = long ? -Infinity : Infinity;
  const excursionPct = favorable / p.entryPrice;
  if (excursionPct > FEE_ARM_MARGIN) {
    const breakeven = long ? p.entryPrice * (1 + FEE_ROUNDTRIP) : p.entryPrice * (1 - FEE_ROUNDTRIP);
    candidate = long ? Math.max(candidate, breakeven) : Math.min(candidate, breakeven);
  }
  if (armed) {
    const trailDist = t.trailRatio * risk;
    const c = long ? best - trailDist : best + trailDist;
    candidate = long ? Math.max(candidate, c) : Math.min(candidate, c);
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
  const { stopPrice, takePrice } = computeStopTake(side, price, cfg.maxLossPercent, cfg.rewardRatio);
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
  };
  state.demo.unshift(pos);
  await putState(state);
  st.daily = { ...st.daily, entries: st.daily.entries + 1 };
  await appendLog(
    "open",
    `دمو ${side === "long" ? "خرید" : "فروش"} ${symbol} @ ${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== cfg.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ""}`
  );
  await announce(
    `🤖 بک‌تست (دمو): ${side === "long" ? "🟢 خرید" : "🔴 فروش"} ${symbol}`,
    `ورود ${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)}\nمنبع: ${sourceLabel} • لوریج ${cfg.leverage}x`
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
    `${reason === "stop" ? "استاپ" : reason === "take" ? "تیک‌پرافیت" : reason === "whale-close" ? "نهنگ بست" : "سیگنال"} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} $${Math.abs(pnl).toFixed(2)}`
  );
  return true;
}

async function markDemo(cfg: AutoCfg, st: StoredAutoConfig, prices: Record<string, number>): Promise<void> {
  const state = await getState();
  let dirty = false;
  for (let i = 0; i < state.demo.length; i++) {
    const p = state.demo[i];
    if (p.status !== "open") continue;
    const px = prices[`${p.symbol}USDT`];
    if (!px || !(px > 0)) continue;
    state.demo[i].lastPrice = px;
    dirty = true;
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
        `${hitStop ? "استاپ" : "تیک‌پرافیت"}${hitStop && pnl >= 0 ? " (ریسک‌فری)" : ""} • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} $${Math.abs(pnl).toFixed(2)}`
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
  const { stopPrice, takePrice } = computeStopTake(side, price, cfg.maxLossPercent, cfg.rewardRatio);
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
    const p = state.real[i];
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
        `بسته شد روی صرافی (استاپ/تیک‌پرافیت) • ${pnl >= 0 ? "✅ سود" : "❌ ضرر"} ~$${Math.abs(pnl).toFixed(2)}`
      );
      continue;
    }
    const mark = parseFloat(lp.markPrice) || p.lastPrice;
    state.real[i].lastPrice = mark;
    const liveQty = Math.abs(amt);
    if (liveQty > 0) state.real[i].qty = liveQty;
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
  const b = body as { secret?: string; config?: Partial<AutoCfg> };
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
  await putConfig(st);
  if (cfg.enabled) {
    // immediate cycle so the user sees action right away
    void runBacktestCycle();
  } else {
    await appendLog("info", "ربات بک‌تست روی سرور متوقف شد");
  }
  return {
    status: 200,
    payload: { ok: true, enabled: cfg.enabled, mode: cfg.mode },
  };
}

export async function getAutoTradeStateFor(secret: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const serverCfg = await store.get<{ secret?: string }>("config");
  if (!serverCfg?.secret || !secret || serverCfg.secret !== secret) {
    return { status: 403, payload: { ok: false, error: "secret mismatch" } };
  }
  const st = await getConfig();
  const state = await getState();
  return {
    status: 200,
    payload: {
      ok: true,
      enabled: st?.cfg.enabled ?? false,
      mode: st?.cfg.mode ?? "demo",
      demoPositions: state.demo.slice(0, 200),
      realPositions: state.real.slice(0, 200),
      logs: state.logs.slice(0, 60),
      lastCycleAt: state.lastCycleAt ?? null,
      serverNow: Date.now(),
    },
  };
}
