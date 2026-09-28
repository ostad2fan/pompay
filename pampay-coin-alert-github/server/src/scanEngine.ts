// server/src/scanEngine.ts
// Server-side scheduled scanner: runs the daily GainzAlgo + custom indicator
// scan right after the UTC midnight candle close, so signals are issued even
// when the phone app is fully closed. Ported 1:1 from the Cloudflare Durable
// Object version — Durable Object storage is replaced by the JSON file store
// and the alarm is driven by scheduler.ts (hourly tick).

import store from "./store";
import { evaluatePineSubset, PineCandle } from "./pine";
import { sendPushToAll } from "./push";
import { sendTelegram } from "./telegram";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerIndicator {
  id: string;
  name: string;
  code: string;
  timeframe: "15m" | "1h" | "4h" | "1d";
  receiveSignals: boolean;
}

type GainzTimeframe = "1h" | "4h" | "1d";
type HookTimeframe = "4h" | "1d";

export interface ScanConfig {
  secret: string;
  botToken: string;
  chatId: string;
  gainzAlgoEnabled: boolean;
  gainzTimeframes: GainzTimeframe[];
  indicators: ServerIndicator[];
  hookEnabled: boolean;
  hookTimeframes: HookTimeframe[];
  /** Fast-cycle flags (pump/dump, meme, pre-listing) — consumed by fastScan.ts */
  scannerEnabled?: boolean;
  memeEnabled?: boolean;
  preListingEnabled?: boolean;
  volumeThreshold?: number;
}

export interface GainzSignal {
  id: string;
  symbol: string;
  displayName: string;
  action: "buy" | "sell";
  price: number;
  rsi: number;
  timeframe: GainzTimeframe;
  /** Binance markets where the symbol trades: "futures" and/or "spot". */
  markets: string[];
  /** True when the signal was detected on the still-forming (live) candle. */
  live?: boolean;
  candleOpenTime: number;
  detectedAt: number;
}

export interface CustomSignal {
  id: string;
  indicatorId: string;
  indicatorName: string;
  symbol: string;
  displayName: string;
  action: "buy" | "sell";
  price: number;
  timeframe: string;
  /** Binance markets where the symbol trades: "futures" and/or "spot". */
  markets: string[];
  candleOpenTime: number;
  detectedAt: number;
}

export interface HookSignal {
  id: string;
  symbol: string;
  displayName: string;
  /** "buy" = bullish hook (lower low, higher close), "sell" = bearish hook. */
  action: "buy" | "sell";
  price: number;
  timeframe: HookTimeframe;
  /** Binance markets where the symbol trades: "futures" and/or "spot". */
  markets: string[];
  /** True when detected on the still-forming (live) candle. */
  live?: boolean;
  candleOpenTime: number;
  detectedAt: number;
}

export interface ScanSummary {
  gainzNew?: number;
  customNew?: number;
  hookNew?: number;
  skipped?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utcDateStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function faDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("fa-IR");
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

// Binance futures, falling back to spot endpoints (some regions block fapi).
const FUTURES_BASE = "https://fapi.binance.com";
const SPOT_BASE = "https://api.binance.com";
let binanceBase: string | null = null;

interface Ticker {
  symbol: string;
  quoteVolume: string;
}

async function fetchTickers(): Promise<Ticker[]> {
  try {
    const data = await getJson<Ticker[]>(`${FUTURES_BASE}/fapi/v1/ticker/24hr`);
    binanceBase = FUTURES_BASE;
    return data.filter((t) => t.symbol.endsWith("USDT"));
  } catch {
    const data = await getJson<Ticker[]>(`${SPOT_BASE}/api/v3/ticker/24hr`);
    binanceBase = SPOT_BASE;
    return data.filter((t) => t.symbol.endsWith("USDT"));
  }
}

async function fetchKlinesRaw(symbol: string, interval: string, limit: number): Promise<number[][]> {
  const base = binanceBase ?? FUTURES_BASE;
  const path = base === SPOT_BASE ? "/api/v3/klines" : "/fapi/v1/klines";
  return getJson<number[][]>(`${base}${path}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
}

// --- Market type detection (futures vs spot), cached ~1 hour ---

interface MarketSets {
  futures: Set<string>;
  spot: Set<string>;
  fetchedAt: number;
}
let marketCache: MarketSets | null = null;

async function getMarketSets(): Promise<MarketSets> {
  if (marketCache && Date.now() - marketCache.fetchedAt < 3600_000) return marketCache;
  const sets: MarketSets = { futures: new Set(), spot: new Set(), fetchedAt: Date.now() };
  try {
    const f = await getJson<{ symbols: { symbol: string }[] }>(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    for (const s of f.symbols) sets.futures.add(s.symbol);
  } catch (e) {
    console.log("[ScanServer] futures exchangeInfo failed:", e);
  }
  try {
    const sp = await getJson<{ symbols: { symbol: string }[] }>(`${SPOT_BASE}/api/v3/exchangeInfo`);
    for (const s of sp.symbols) sets.spot.add(s.symbol);
  } catch (e) {
    console.log("[ScanServer] spot exchangeInfo failed:", e);
  }
  marketCache = sets;
  return sets;
}

function marketsFor(symbol: string, sets: MarketSets): string[] {
  const out: string[] = [];
  if (sets.futures.has(symbol)) out.push("futures");
  if (sets.spot.has(symbol)) out.push("spot");
  return out.length > 0 ? out : ["futures"];
}

const TF_LABEL: Record<GainzTimeframe, string> = {
  "1h": "۱ ساعته",
  "4h": "۴ ساعته",
  "1d": "روزانه",
};

function marketsLabel(markets: string[] | undefined): string {
  const list = markets && markets.length > 0 ? markets : ["futures"];
  return list.map((m) => (m === "futures" ? "فیوچرز" : m === "spot" ? "اسپات" : m)).join(" + ");
}

// ---------------------------------------------------------------------------
// GainzAlgo Pro (port of the client-side implementation)
// ---------------------------------------------------------------------------

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function calculateRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(0);
  if (closes.length <= period) return rsi;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calculateTrueRange(candles: Candle[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[0].high - candles[0].low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(candles[i].high, prevClose) - Math.min(candles[i].low, prevClose));
  }
  return tr;
}

function analyzeGainzAlgoCandles(
  candles: Candle[]
): { action: "buy" | "sell"; price: number; rsi: number } | null {
  const n = candles.length;
  const delta = 5;
  const startIndex = Math.max(14, delta + 1);
  if (n < startIndex + 2) return null;

  const closes = candles.map((c) => c.close);
  const rsiSeries = calculateRSI(closes, 14);
  const trSeries = calculateTrueRange(candles);

  let lastSignal: "buy" | "sell" | null = null;

  for (let i = startIndex; i < n; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = trSeries[i];
    if (!tr || tr === 0) continue;

    const isStableCandle = Math.abs(c.close - c.open) / tr > 0.5;
    const currentRsi = rsiSeries[i];
    const closeOverDelta = candles[i - delta].close;

    const bullishEngulfing =
      prev.close < prev.open && c.close > c.open && c.close > prev.open;
    const bull = bullishEngulfing && isStableCandle && currentRsi < 50 && c.close < closeOverDelta;

    const bearishEngulfing =
      prev.close > prev.open && c.close < c.open && c.close < prev.open;
    const bear = bearishEngulfing && isStableCandle && currentRsi > 50 && c.close > closeOverDelta;

    if (bull && lastSignal !== "buy") lastSignal = "buy";
    else if (bear && lastSignal !== "sell") lastSignal = "sell";
    else continue;

    if (i === n - 1) {
      return { action: lastSignal, price: c.close, rsi: Math.round(currentRsi * 10) / 10 };
    }
  }
  return null;
}

function parseDailyCandles(raw: number[][], includeForming = false): Candle[] {
  // By default the last kline is still forming -> excluded (confirmed bars only)
  const list = includeForming ? raw : raw.slice(0, -1);
  return list.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
  }));
}

async function scanGainzAlgo(
  timeframes: GainzTimeframe[],
  marketSets: MarketSets,
  maxSymbols = 40
): Promise<GainzSignal[]> {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals: GainzSignal[] = [];
  const batchSize = 6;
  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlinesRaw(ticker.symbol, tf, 60);
            const evaluate = (candles: Candle[], live: boolean) => {
              if (candles.length < 25) return;
              const result = analyzeGainzAlgoCandles(candles);
              if (!result) return;
              const last = candles[candles.length - 1];
              signals.push({
                id: `gainz-${tf}-${ticker.symbol}-${result.action}-${last.openTime}`,
                symbol: ticker.symbol,
                displayName: ticker.symbol.replace("USDT", "/USDT"),
                action: result.action,
                price: result.price,
                rsi: result.rsi,
                timeframe: tf,
                markets: marketsFor(ticker.symbol, marketSets),
                live,
                candleOpenTime: last.openTime,
                detectedAt: Date.now(),
              });
            };
            // Just-closed candle + the currently forming (live) candle.
            evaluate(parseDailyCandles(raw), false);
            evaluate(parseDailyCandles(raw, true), true);
          } catch (e) {
            console.log(`[ScanServer] kline error ${ticker.symbol}:`, e);
          }
        })
      );
    }
  }
  signals.sort((a, b) => b.action.localeCompare(a.action) || b.detectedAt - a.detectedAt);
  return signals;
}

// ---------------------------------------------------------------------------
// Custom indicators scan
// ---------------------------------------------------------------------------

function parseRawKlines(raw: number[][]): PineCandle[] {
  return raw.slice(0, -1).map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

async function scanCustomIndicators(
  indicators: ServerIndicator[],
  marketSets: MarketSets
): Promise<{ signals: CustomSignal[]; errors: Record<string, string> }> {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 30);

  const klineCache = new Map<string, PineCandle[]>();
  const signals: CustomSignal[] = [];
  const errors: Record<string, string> = {};

  for (const indicator of indicators) {
    let evaluated = 0;
    for (const ticker of sorted) {
      const cacheKey = `${ticker.symbol}:${indicator.timeframe}`;
      try {
        let candles = klineCache.get(cacheKey);
        if (!candles) {
          const raw = await fetchKlinesRaw(ticker.symbol, indicator.timeframe, 150);
          candles = parseRawKlines(raw);
          klineCache.set(cacheKey, candles);
        }
        if (candles.length < 25) continue;
        evaluated++;

        const result = evaluatePineSubset(indicator.code, candles);
        if (!result || (!result.buySignal && !result.sellSignal)) continue;

        const action: "buy" | "sell" = result.buySignal ? "buy" : "sell";
        const signalCandle = candles[candles.length - 1];
        signals.push({
          id: `ci-${indicator.id}-${ticker.symbol}-${action}-${signalCandle.openTime}`,
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          symbol: ticker.symbol,
          displayName: ticker.symbol.replace("USDT", "/USDT"),
          action,
          price: signalCandle.close,
          timeframe: indicator.timeframe,
          markets: marketsFor(ticker.symbol, marketSets),
          candleOpenTime: signalCandle.openTime,
          detectedAt: Date.now(),
        });
      } catch (e) {
        errors[indicator.id] = e instanceof Error ? e.message : String(e);
      }
    }
    if (evaluated > 0 && !errors[indicator.id]) delete errors[indicator.id];
    console.log(`[ScanServer] "${indicator.name}" evaluated ${evaluated} symbols`);
  }
  return { signals, errors };
}

// ---------------------------------------------------------------------------
// Hook Reversal scan (bullish/bearish hook on 4h/1d candles)
// ---------------------------------------------------------------------------

/**
 * Hook Reversal (bullish): candle makes a LOWER LOW than the previous candle
 * but CLOSES ABOVE the previous close — sellers absorbed, potential reversal up.
 * Bearish: HIGHER HIGH with a close BELOW the previous close.
 */
function detectHook(
  candles: Candle[]
): { action: "buy" | "sell"; price: number } | null {
  const n = candles.length;
  if (n < 2) return null;
  const c = candles[n - 1];
  const prev = candles[n - 2];
  if (c.low < prev.low && c.close > prev.close) return { action: "buy", price: c.close };
  if (c.high > prev.high && c.close < prev.close) return { action: "sell", price: c.close };
  return null;
}

async function scanHookReversal(
  timeframes: HookTimeframe[],
  marketSets: MarketSets,
  maxSymbols = 40
): Promise<HookSignal[]> {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals: HookSignal[] = [];
  const batchSize = 6;
  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlinesRaw(ticker.symbol, tf, 30);
            const evaluate = (candles: Candle[], live: boolean) => {
              const result = detectHook(candles);
              if (!result) return;
              const last = candles[candles.length - 1];
              signals.push({
                id: `hook-${tf}-${ticker.symbol}-${result.action}-${last.openTime}`,
                symbol: ticker.symbol,
                displayName: ticker.symbol.replace("USDT", "/USDT"),
                action: result.action,
                price: result.price,
                timeframe: tf,
                markets: marketsFor(ticker.symbol, marketSets),
                live,
                candleOpenTime: last.openTime,
                detectedAt: Date.now(),
              });
            };
            // Just-closed candle + the currently forming (live) candle.
            evaluate(parseDailyCandles(raw), false);
            evaluate(parseDailyCandles(raw, true), true);
          } catch (e) {
            console.log(`[ScanServer] hook kline error ${ticker.symbol}:`, e);
          }
        })
      );
    }
  }
  signals.sort((a, b) => b.action.localeCompare(a.action) || b.detectedAt - a.detectedAt);
  return signals;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function buildGainzText(signals: GainzSignal[]): string {
  const lines: string[] = ["📊 <b>اندیکاتور GainzAlgo Pro</b>", "🖥 <i>اسکن خودکار سرور</i>\n"];
  let shown = 0;
  for (const tf of ["1d", "4h", "1h"] as GainzTimeframe[]) {
    const group = signals.filter((s) => (s.timeframe ?? "1d") === tf);
    if (group.length === 0) continue;
    lines.push(`⏱ <b>تایم‌فریم ${TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
    for (const sig of group) {
      // ALL signals are included — long texts are split into multiple
      // Telegram messages by the shared sender (telegram.ts).
      shown++;
      const icon = sig.action === "buy" ? "🟢" : "🔴";
      const action = sig.action === "buy" ? "سیگنال خرید (BUY)" : "سیگنال فروش (SELL)";
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${action}`,
        `   💰 قیمت بسته شدن کندل: $${sig.price.toFixed(4)}`,
        `   📈 RSI(14): ${sig.rsi}`,
        `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
        `   🕐 کندل ${TF_LABEL[tf]}${sig.live ? " (در حال ساخت)" : ""}: ${faDate(sig.candleOpenTime)}`,
        ""
      );
    }
  }
  return lines.join("\n");
}

function buildCustomText(signals: CustomSignal[]): string {
  const lines = ["🧩 <b>سیگنال اندیکاتور دستی</b>", "🖥 <i>اسکن خودکار سرور</i>\n"];
  for (const sig of signals) {
    const icon = sig.action === "buy" ? "🟢" : "🔴";
    lines.push(
      `${icon} <b>${sig.displayName}</b> — ${sig.action === "buy" ? "<b>BUY</b>" : "<b>SELL</b>"}`,
      `   🧩 اندیکاتور: ${sig.indicatorName}`,
      `   💰 قیمت: $${sig.price.toFixed(4)}`,
      `   ⏱ تایم‌فریم: ${TF_LABEL[sig.timeframe as GainzTimeframe] ?? sig.timeframe}`,
      `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
      `   🕐 کندل: ${faDate(sig.candleOpenTime)}`,
      ""
    );
  }
  return lines.join("\n");
}

const HOOK_TF_LABEL: Record<HookTimeframe, string> = {
  "4h": "۴ ساعته",
  "1d": "روزانه",
};

function buildHookText(signals: HookSignal[]): string {
  const lines: string[] = ["🪝 <b>هوک ریورسال</b>", "🖥 <i>اسکن خودکار سرور</i>\n"];
  let shown = 0;
  for (const tf of ["1d", "4h"] as HookTimeframe[]) {
    const group = signals.filter((s) => s.timeframe === tf);
    if (group.length === 0) continue;
    lines.push(`⏱ <b>تایم‌فریم ${HOOK_TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
    for (const sig of group) {
      // ALL signals are included — long texts are split into multiple
      // Telegram messages by the shared sender (telegram.ts).
      shown++;
      const icon = sig.action === "buy" ? "🟢" : "🔴";
      const label = sig.action === "buy" ? "هوک صعودی" : "هوک نزولی";
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${label}`,
        `   💰 قیمت لحظه‌ی شناسایی: $${sig.price.toFixed(4)}`,
        `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
        `   🕐 کندل ${HOOK_TF_LABEL[tf]}${sig.live ? " (در حال ساخت)" : ""}: ${faDate(sig.candleOpenTime)}`,
        ""
      );
    }
  }
  if (signals.length > shown) lines.push(`... و ${signals.length - shown} سیگنال دیگر`);
  lines.push("📉 داده از Binance • هوک صعودی: کف پایین‌تر + بسته‌شدن بالاتر • هوک نزولی: سقف بالاتر + بسته‌شدن پایین‌تر");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The scheduler engine (replaces the Durable Object)
// ---------------------------------------------------------------------------

function boundKeys(map: Record<string, boolean>, cap: number): Record<string, boolean> {
  const entries = Object.keys(map).slice(-cap);
  const bounded: Record<string, boolean> = {};
  for (const key of entries) bounded[key] = true;
  return bounded;
}

/** Short one-line summary used for push notification bodies. */
function signalPushText(kind: "gainz" | "custom" | "hook", fresh: { action: string; displayName: string; price: number; timeframe: string }[]): string {
  const top = fresh[0];
  const more = fresh.length > 1 ? ` +${fresh.length - 1} مورد دیگر` : "";
  const label = kind === "gainz" ? "GainzAlgo" : kind === "hook" ? "هوک ریورسال" : "اندیکاتور دستی";
  const dir = top.action === "buy" ? "🟢 خرید" : "🔴 فروش";
  return `${label}: ${dir} ${top.displayName} @ $${top.price.toFixed(4)} (${top.timeframe})${more}`;
}

class ScanEngine {
  private scanInFlight = false;

  /** Called by scheduler once per hour (and once on boot for catch-up). */
  async alarmTick(): Promise<void> {
    console.log("[ScanScheduler] alarm fired — running scheduled scan tick");
    await this.runScanCycle("alarm");
  }

  /**
   * Quick tick (every ~10 min): scans 15-minute custom indicators so they
   * fire close to the 15m candle closes instead of once per day.
   */
  async quickTick(): Promise<void> {
    try {
      const cfg = await store.get<ScanConfig>("config");
      if (!cfg || !cfg.botToken || !cfg.chatId) return;
      const quick = (cfg.indicators ?? []).filter(
        (i) => i.receiveSignals && i.timeframe === "15m" && i.code.trim().length > 0
      );
      if (quick.length === 0) return;
      const lastQuickAt = (await store.get<number>("lastQuickScanAt")) ?? 0;
      if (Date.now() - lastQuickAt < 9 * 60_000) return;
      await store.put("lastQuickScanAt", Date.now());

      const marketSets = await getMarketSets();
      const { signals: fresh, errors } = await scanCustomIndicators(quick, marketSets);
      await store.put("customErrors", errors);

      const stored = (await store.get<CustomSignal[]>("customSignals")) ?? [];
      const ids = new Set(stored.map((s) => s.id));
      const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 200);

      const keys = (await store.get<Record<string, boolean>>("customNotifyKeys")) ?? {};
      const isFirstRun = Object.keys(keys).length === 0;
      const announce = fresh.filter((s) => !keys[s.id]);
      for (const s of fresh) keys[s.id] = true;

      await store.put("customNotifyKeys", boundKeys(keys, 600));
      await store.put("customSignals", merged);

      if (!isFirstRun && announce.length > 0) {
        await sendTelegram(cfg, buildCustomText(announce));
        await sendPushToAll(
          "🧩 سیگنال اندیکاتور دستی",
          signalPushText("custom", announce),
          { kind: "custom", count: announce.length }
        );
      }
      console.log(`[ScanServer] quickTick (15m indicators): ${fresh.length} current, ${announce.length} new`);
    } catch (e) {
      console.log("[ScanServer] quickTick failed:", e);
    }
  }

  async handleConfig(body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    const b = body as {
      secret?: string;
      botToken?: string;
      chatId?: string;
      gainzAlgoEnabled?: boolean;
      gainzTimeframes?: GainzTimeframe[];
      indicators?: ServerIndicator[];
      hookEnabled?: boolean;
      hookTimeframes?: HookTimeframe[];
      scannerEnabled?: boolean;
      memeEnabled?: boolean;
      preListingEnabled?: boolean;
      volumeThreshold?: number;
    };

    if (!b?.secret || typeof b.secret !== "string") {
      return { status: 400, payload: { ok: false, error: "missing secret" } };
    }

    const existing = await store.get<ScanConfig>("config");
    if (existing && existing.secret !== b.secret) {
      return { status: 403, payload: { ok: false, error: "unauthorized" } };
    }

    const indicators: ServerIndicator[] = Array.isArray(b.indicators)
      ? b.indicators
          .filter((i) => i && typeof i.id === "string" && typeof i.code === "string")
          .slice(0, 30)
          .map((i) => ({
            id: i.id,
            name: String(i.name ?? "").slice(0, 60),
            code: i.code.slice(0, 8000),
            timeframe: (["15m", "1h", "4h", "1d"] as const).includes(i.timeframe)
              ? i.timeframe
              : "1d",
            receiveSignals: !!i.receiveSignals,
          }))
      : [];

    const rawTfs = Array.isArray(b.gainzTimeframes) ? b.gainzTimeframes : [];
    const gainzTimeframes = rawTfs.filter(
      (t): t is GainzTimeframe => t === "1h" || t === "4h" || t === "1d"
    );

    const rawHookTfs = Array.isArray(b.hookTimeframes) ? b.hookTimeframes : [];
    const hookTimeframes = rawHookTfs.filter(
      (t): t is HookTimeframe => t === "4h" || t === "1d"
    );

    const cfg: ScanConfig = {
      secret: b.secret,
      botToken: (b.botToken ?? "").trim(),
      chatId: (b.chatId ?? "").trim(),
      gainzAlgoEnabled: b.gainzAlgoEnabled !== false,
      gainzTimeframes: gainzTimeframes.length > 0 ? gainzTimeframes : ["1d"],
      indicators,
      hookEnabled: b.hookEnabled === true,
      hookTimeframes: hookTimeframes.length > 0 ? hookTimeframes : ["1d"],
      scannerEnabled: b.scannerEnabled !== false,
      memeEnabled: b.memeEnabled !== false,
      preListingEnabled: b.preListingEnabled !== false,
      volumeThreshold:
        typeof b.volumeThreshold === "number" && b.volumeThreshold >= 1 && b.volumeThreshold <= 10
          ? b.volumeThreshold
          : 2.0,
    };
    await store.put("config", cfg);

    // Catch-up: if today's scan hasn't happened yet (app was closed across
    // midnight), run it right away so the user gets missed signals.
    const lastScanDate = (await store.get<string>("lastScanDate")) ?? "";
    if (cfg.botToken && cfg.chatId && lastScanDate !== utcDateStr()) {
      const summary = await this.runScanCycle("catchup");
      return { status: 200, payload: { ok: true, scanned: true, summary } };
    }
    return { status: 200, payload: { ok: true, scanned: false } };
  }

  async signalsResponse(): Promise<Record<string, unknown>> {
    const [gainz, custom, hook, lastScanDate, lastScanAt] = await Promise.all([
      store.get<GainzSignal[]>("gainzSignals"),
      store.get<CustomSignal[]>("customSignals"),
      store.get<HookSignal[]>("hookSignals"),
      store.get<string>("lastScanDate"),
      store.get<number>("lastScanAt"),
    ]);

    // Lazy catch-up without blocking the response.
    if (lastScanDate && lastScanDate !== utcDateStr()) {
      void this.runScanCycle("catchup").catch((e: unknown) =>
        console.log("[ScanServer] catchup failed:", e)
      );
    }

    return {
      ok: true,
      gainzSignals: gainz ?? [],
      customSignals: custom ?? [],
      hookSignals: hook ?? [],
      lastScanDate: lastScanDate ?? null,
      lastScanAt: lastScanAt ?? null,
    };
  }

  /**
   * One full scan cycle. Idempotent: the hourly tick may fire more than once
   * and notify-key dedupe prevents duplicate Telegram/push announcements.
   */
  async runScanCycle(trigger: "alarm" | "catchup" | "manual"): Promise<ScanSummary> {
    if (this.scanInFlight) return { skipped: "busy" };
    const cfg = await store.get<ScanConfig>("config");
    if (!cfg || !cfg.botToken || !cfg.chatId) return { skipped: "no-config" };

    const hour = new Date().getUTCHours();
    const isMidnight = hour === 0;
    const selected = cfg.gainzTimeframes ?? ["1d"];

    // Timeframes whose candle closes at this tick: 1h every hour, 4h every 4h.
    const tickTfs: GainzTimeframe[] = [];
    if (selected.includes("1h")) tickTfs.push("1h");
    if (selected.includes("4h") && hour % 4 === 0) tickTfs.push("4h");

    const lastScanDate = (await store.get<string>("lastScanDate")) ?? "";
    const dailyDue = trigger === "manual" || isMidnight || lastScanDate !== utcDateStr();

    if (tickTfs.length === 0 && !dailyDue) return { skipped: "not-due" };

    if (trigger !== "manual") {
      if (isMidnight) {
        if (lastScanDate === utcDateStr()) return { skipped: "already-scanned" };
      } else if (!dailyDue) {
        // Hourly ticks: at most one run per half hour (also covers catch-up calls).
        const lastScanAt = (await store.get<number>("lastScanAt")) ?? 0;
        if (Date.now() - lastScanAt < 30 * 60_000) return { skipped: "recent" };
      }
    }

    this.scanInFlight = true;
    try {
      let gainzNew = 0;
      let customNew = 0;
      let hookNew = 0;
      const marketSets = await getMarketSets();

      // --- GainzAlgo ---
      // 1h/4h: scanned at every candle close AND hourly on the forming candle.
      // 1d: scanned once per day (UTC midnight) on the confirmed candle.
      if (cfg.gainzAlgoEnabled && (dailyDue || tickTfs.length > 0)) {
        try {
          const tfs = dailyDue ? selected : tickTfs;
          const fresh = await scanGainzAlgo(tfs, marketSets);
          const stored = (await store.get<GainzSignal[]>("gainzSignals")) ?? [];
          const ids = new Set(stored.map((s) => s.id));
          const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 240);

          const keys = (await store.get<Record<string, boolean>>("gainzNotifyKeys")) ?? {};
          const isFirstRun = Object.keys(keys).length === 0;
          const announce = fresh.filter((s) => !keys[s.id]);
          for (const s of fresh) keys[s.id] = true;

          await store.put("gainzNotifyKeys", boundKeys(keys, 1000));
          await store.put("gainzSignals", merged);

          if (!isFirstRun && announce.length > 0) {
            gainzNew = announce.length;
            await sendTelegram(cfg, buildGainzText(announce));
            await sendPushToAll(
              "📊 سیگنال جدید GainzAlgo",
              signalPushText("gainz", announce),
              { kind: "gainz", count: announce.length }
            );
          }
          console.log(`[ScanServer] gainz cycle: ${fresh.length} current, ${gainzNew} new`);
        } catch (e) {
          console.log("[ScanServer] gainz scan failed:", e);
        }
      }

      // --- Custom indicators (scanned when their timeframe's candle closes,
      // not only once a day: 1h → every hourly tick, 4h → every 4h, 1d → daily;
      // 15m indicators are handled by quickTick() every ~10 minutes) ---
      {
        const active = cfg.indicators.filter((i) => i.receiveSignals && i.code.trim().length > 0);
        const due = active.filter((i) => {
          if (dailyDue) return true;
          if (i.timeframe === "15m") return false; // quickTick's job
          if (i.timeframe === "1h") return true; // hourly tick
          if (i.timeframe === "4h") return hour % 4 === 0;
          return false; // 1d handled by dailyDue
        });
        if (due.length > 0) {
          const indicatorTfs = new Set(due.map((i) => i.timeframe));
          console.log(`[ScanServer] custom indicators due this tick: ${due.length} (TFs: ${[...indicatorTfs].join(",")})`);
          try {
            const { signals: fresh, errors } = await scanCustomIndicators(due, marketSets);
            await store.put("customErrors", errors);

            const stored = (await store.get<CustomSignal[]>("customSignals")) ?? [];
            const ids = new Set(stored.map((s) => s.id));
            const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 200);

            const keys = (await store.get<Record<string, boolean>>("customNotifyKeys")) ?? {};
            const isFirstRun = Object.keys(keys).length === 0;
            const announce = fresh.filter((s) => !keys[s.id]);
            for (const s of fresh) keys[s.id] = true;

            await store.put("customNotifyKeys", boundKeys(keys, 600));
            await store.put("customSignals", merged);

            if (!isFirstRun && announce.length > 0) {
              customNew = announce.length;
              await sendTelegram(cfg, buildCustomText(announce));
              await sendPushToAll(
                "🧩 سیگنال اندیکاتور دستی",
                signalPushText("custom", announce),
                { kind: "custom", count: announce.length }
              );
            }
            console.log(`[ScanServer] custom cycle: ${fresh.length} current, ${customNew} new`);
          } catch (e) {
            console.log("[ScanServer] custom scan failed:", e);
          }
        }
      }

      // --- Hook Reversal (4h at every 4h candle close + hourly forming-candle
      // check; 1d once per day on the confirmed candle) ---
      if (cfg.hookEnabled) {
        const hookTfs = cfg.hookTimeframes ?? ["1d"];
        const hook4hDue = hookTfs.includes("4h") && hour % 4 === 0;
        if (dailyDue || hook4hDue) {
          try {
            const tfs: HookTimeframe[] = dailyDue ? hookTfs : ["4h"];
            const fresh = await scanHookReversal(tfs, marketSets);
            const stored = (await store.get<HookSignal[]>("hookSignals")) ?? [];
            const ids = new Set(stored.map((s) => s.id));
            const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 200);

            const keys = (await store.get<Record<string, boolean>>("hookNotifyKeys")) ?? {};
            const isFirstRun = Object.keys(keys).length === 0;
            const announce = fresh.filter((s) => !keys[s.id]);
            for (const s of fresh) keys[s.id] = true;

            await store.put("hookNotifyKeys", boundKeys(keys, 700));
            await store.put("hookSignals", merged);

            if (!isFirstRun && announce.length > 0) {
              hookNew = announce.length;
              await sendTelegram(cfg, buildHookText(announce));
              await sendPushToAll(
                "🪝 سیگنال هوک ریورسال",
                signalPushText("hook", announce),
                { kind: "hook", count: announce.length }
              );
            }
            console.log(`[ScanServer] hook cycle: ${fresh.length} current, ${hookNew} new`);
          } catch (e) {
            console.log("[ScanServer] hook scan failed:", e);
          }
        }
      }

      await store.put("lastScanAt", Date.now());
      if (dailyDue) await store.put("lastScanDate", utcDateStr());
      return { gainzNew, customNew, hookNew };
    } finally {
      this.scanInFlight = false;
    }
  }
}

export const scanEngine = new ScanEngine();
