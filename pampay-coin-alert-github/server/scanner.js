/**
 * scanner.js — Node.js port of functions/scan-server.ts (Cloudflare Durable Object).
 * Runs the GainzAlgo / custom-indicator / Hook-Reversal scans against Binance,
 * stores the results through store.js and announces new signals on Telegram
 * (+ native push) — even when the phone app is fully closed.
 */
const store = require('./store');

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function msUntilNextUtcHour() {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    0,
    30,
    0
  );
  return Math.max(next - now.getTime(), 1000);
}

function faDate(ms) {
  try {
    return new Date(ms).toLocaleDateString('fa-IR');
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

// Tehran clock = UTC+3:30 year-round (Iran abolished DST in 2022).
function tehranClock(ms) {
  const d = new Date(ms + 3.5 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Candle duration per timeframe — used to compute the candle close time. */
const CANDLE_TF_MS = {
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/**
 * One-line candle timing (open + close in Iran time) so the user can find the
 * exact candle on the chart. e.g:
 * «کلوز کندل ۱ ساعته: ساعت 15:00 به وقت ایران (UTC+3:30) — کندل باز شده در 14:00 • ۱۴۰۴/۰۷/۰۳»
 */
function candleTimeLine(tf, candleOpenTime, live = false, tfLabelOverride) {
  const tfMs = CANDLE_TF_MS[tf] ?? CANDLE_TF_MS['1d'];
  const label = tfLabelOverride ?? TF_LABEL[tf] ?? tf;
  const closeMs = candleOpenTime + tfMs;
  const tz = 'وقت ایران (UTC+3:30)';
  if (live) {
    return `   🕐 کندل ${label} هنوز در حال ساخت است — باز شده در ساعت ${tehranClock(candleOpenTime)} و کلوز بعدی آن ساعت ${tehranClock(closeMs)} به ${tz}`;
  }
  return `   🕐 سیگنال در کلوز کندل ${label} — ساعت ${tehranClock(closeMs)} به ${tz}` +
    ` • کندل باز شده در ساعت ${tehranClock(candleOpenTime)} • ${faDate(candleOpenTime)}`;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Binance futures, falling back to spot endpoints (some regions block fapi).
const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';
let binanceBase = null;

async function fetchTickers() {
  try {
    const data = await getJson(`${FUTURES_BASE}/fapi/v1/ticker/24hr`);
    binanceBase = FUTURES_BASE;
    return data.filter((t) => t.symbol.endsWith('USDT'));
  } catch {
    const data = await getJson(`${SPOT_BASE}/api/v3/ticker/24hr`);
    binanceBase = SPOT_BASE;
    return data.filter((t) => t.symbol.endsWith('USDT'));
  }
}

async function fetchKlinesRaw(symbol, interval, limit) {
  const base = binanceBase ?? FUTURES_BASE;
  const path = base === SPOT_BASE ? '/api/v3/klines' : '/fapi/v1/klines';
  return getJson(`${base}${path}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
}

// --- Market type detection (futures vs spot), cached ~1 hour ---

let marketCache = null;

async function getMarketSets() {
  if (marketCache && Date.now() - marketCache.fetchedAt < 3600_000) return marketCache;
  const sets = { futures: new Set(), spot: new Set(), fetchedAt: Date.now() };
  try {
    const f = await getJson(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    for (const s of f.symbols) sets.futures.add(s.symbol);
  } catch (e) {
    console.log('[ScanServer] futures exchangeInfo failed:', e);
  }
  try {
    const sp = await getJson(`${SPOT_BASE}/api/v3/exchangeInfo`);
    for (const s of sp.symbols) sets.spot.add(s.symbol);
  } catch (e) {
    console.log('[ScanServer] spot exchangeInfo failed:', e);
  }
  marketCache = sets;
  return sets;
}

function marketsFor(symbol, sets) {
  const out = [];
  if (sets.futures.has(symbol)) out.push('futures');
  if (sets.spot.has(symbol)) out.push('spot');
  return out.length > 0 ? out : ['futures'];
}

const TF_LABEL = {
  '15m': '۱۵ دقیقه',
  '30m': '۳۰ دقیقه',
  '1h': '۱ ساعته',
  '4h': '۴ ساعته',
  '1d': 'روزانه',
};
const HOOK_TF_LABEL = { '4h': '۴ ساعته', '1d': 'روزانه' };
/** Milliseconds of candle coverage per GainzAlgo timeframe (server cadence). */
const GAINZ_TF_MS = {
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

function marketsLabel(markets) {
  const list = markets && markets.length > 0 ? markets : ['futures'];
  return list.map((m) => (m === 'futures' ? 'فیوچرز' : m === 'spot' ? 'اسپات' : m)).join(' + ');
}

// ---------------------------------------------------------------------------
// GainzAlgo Pro (port of the client-side implementation)
// ---------------------------------------------------------------------------

function calculateRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(0);
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

function calculateTrueRange(candles) {
  const tr = [];
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

function analyzeGainzAlgoCandles(candles) {
  const n = candles.length;
  const delta = 5;
  const startIndex = Math.max(14, delta + 1);
  if (n < startIndex + 2) return null;

  const closes = candles.map((c) => c.close);
  const rsiSeries = calculateRSI(closes, 14);
  const trSeries = calculateTrueRange(candles);

  let lastSignal = null;

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

    if (bull && lastSignal !== 'buy') lastSignal = 'buy';
    else if (bear && lastSignal !== 'sell') lastSignal = 'sell';
    else continue;

    if (i === n - 1) {
      return { action: lastSignal, price: c.close, rsi: Math.round(currentRsi * 10) / 10 };
    }
  }
  return null;
}

function parseDailyCandles(raw, includeForming = false) {
  const list = includeForming ? raw : raw.slice(0, -1);
  return list.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
  }));
}

async function scanGainzAlgo(timeframes, marketSets, maxSymbols = 40) {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals = [];
  const batchSize = 6;
  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlinesRaw(ticker.symbol, tf, 60);
            const evaluate = (candles, live) => {
              if (candles.length < 25) return;
              const result = analyzeGainzAlgoCandles(candles);
              if (!result) return;
              const last = candles[candles.length - 1];
              signals.push({
                id: `gainz-${tf}-${ticker.symbol}-${result.action}-${last.openTime}`,
                symbol: ticker.symbol,
                displayName: ticker.symbol.replace('USDT', '/USDT'),
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
// Custom indicators scan (Pine subset via bundled evaluator)
// ---------------------------------------------------------------------------

const { evaluatePineSubset } = require('./lib/pine.js');

function parseRawKlines(raw) {
  return raw.slice(0, -1).map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

async function scanCustomIndicators(indicators, marketSets) {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 30);

  const klineCache = new Map();
  const signals = [];
  const errors = {};

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

        const action = result.buySignal ? 'buy' : 'sell';
        const signalCandle = candles[candles.length - 1];
        signals.push({
          id: `ci-${indicator.id}-${ticker.symbol}-${action}-${signalCandle.openTime}`,
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          symbol: ticker.symbol,
          displayName: ticker.symbol.replace('USDT', '/USDT'),
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

function detectHook(candles) {
  const n = candles.length;
  if (n < 2) return null;
  const c = candles[n - 1];
  const prev = candles[n - 2];
  if (c.low < prev.low && c.close > prev.close) return { action: 'buy', price: c.close };
  if (c.high > prev.high && c.close < prev.close) return { action: 'sell', price: c.close };
  return null;
}

async function scanHookReversal(timeframes, marketSets, maxSymbols = 40) {
  const tickers = await fetchTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals = [];
  const batchSize = 6;
  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlinesRaw(ticker.symbol, tf, 30);
            const evaluate = (candles, live) => {
              const result = detectHook(candles);
              if (!result) return;
              const last = candles[candles.length - 1];
              signals.push({
                id: `hook-${tf}-${ticker.symbol}-${result.action}-${last.openTime}`,
                symbol: ticker.symbol,
                displayName: ticker.symbol.replace('USDT', '/USDT'),
                action: result.action,
                price: result.price,
                timeframe: tf,
                markets: marketsFor(ticker.symbol, marketSets),
                live,
                candleOpenTime: last.openTime,
                detectedAt: Date.now(),
              });
            };
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

function buildGainzText(signals) {
  const lines = ['📊 <b>اندیکاتور GainzAlgo Pro</b>', '🖥 <i>اسکن خودکار سرور</i>\n'];
  for (const tf of ['1d', '4h', '1h', '30m', '15m']) {
    const group = signals.filter((s) => (s.timeframe ?? '1d') === tf);
    if (group.length === 0) continue;
    lines.push(`⏱ <b>تایم‌فریم ${TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
    // Every signal of every timeframe is included — the Telegram sender
    // splits long messages into chunks automatically.
    for (const sig of group) {
      const icon = sig.action === 'buy' ? '🟢' : '🔴';
      const action = sig.action === 'buy' ? 'سیگنال خرید (BUY)' : 'سیگنال فروش (SELL)';
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${action}`,
        `   💰 قیمت بسته شدن کندل: $${sig.price.toFixed(4)}`,
        `   📈 RSI(14): ${sig.rsi}`,
        `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
        candleTimeLine(tf, sig.candleOpenTime, sig.live),
        ''
      );
    }
  }
  lines.push('📉 داده از Binance • فقط کندل‌های تکمیل‌شده بررسی می‌شوند');
  return lines.join('\n');
}

function buildCustomText(signals) {
  const lines = ['🧩 <b>سیگنال اندیکاتور دستی</b>', '🖥 <i>اسکن خودکار سرور</i>\n'];
  // ALL custom-indicator signals — no truncation.
  for (const sig of signals) {
    const icon = sig.action === 'buy' ? '🟢' : '🔴';
    lines.push(
      `${icon} <b>${sig.displayName}</b> — ${sig.action === 'buy' ? '<b>BUY</b>' : '<b>SELL</b>'}`,
      `   🧩 اندیکاتور: ${sig.indicatorName}`,
      `   💰 قیمت: $${sig.price.toFixed(4)}`,
      `   ⏱ تایم‌فریم: ${TF_LABEL[sig.timeframe] ?? sig.timeframe}`,
      `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
      candleTimeLine(sig.timeframe, sig.candleOpenTime, sig.live),
      ''
    );
  }
  return lines.join('\n');
}

function buildHookText(signals) {
  const lines = ['🪝 <b>هوک ریورسال</b>', '🖥 <i>اسکن خودکار سرور</i>\n'];
  for (const tf of ['1d', '4h']) {
    const group = signals.filter((s) => s.timeframe === tf);
    if (group.length === 0) continue;
    lines.push(`⏱ <b>تایم‌فریم ${HOOK_TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
    // Every hook signal is included — no truncation.
    for (const sig of group) {
      const icon = sig.action === 'buy' ? '🟢' : '🔴';
      const label = sig.action === 'buy' ? 'هوک صعودی' : 'هوک نزولی';
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${label}`,
        `   💰 قیمت لحظه‌ی شناسایی: $${sig.price.toFixed(4)}`,
        `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
        candleTimeLine(tf, sig.candleOpenTime, sig.live, HOOK_TF_LABEL[tf]),
        ''
      );
    }
  }
  lines.push('📉 داده از Binance • هوک صعودی: کف پایین‌تر + بسته‌شدن بالاتر • هوک نزولی: سقف بالاتر + بسته‌شدن پایین‌تر');
  return lines.join('\n');
}

const TELEGRAM_MAX_LEN = 3800;

/** Splits long texts into Telegram-safe chunks on line boundaries. */
function splitTelegramText(text, limit = TELEGRAM_MAX_LEN) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if ((current + '\n' + line).length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegram(cfg, text) {
  try {
    // Long lists (e.g. dozens of signals) are split into several messages so
    // nothing is ever truncated by Telegram's 4096-char limit.
    const chunks = splitTelegramText(text);
    let ok = true;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleepMs(400); // stay under the bot rate limit
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text: chunks[i], parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        console.log(`[ScanServer] telegram send failed: ${res.status}`);
        ok = false;
      }
    }
    return ok;
  } catch (e) {
    console.log('[ScanServer] telegram error:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Native push (Expo Push) — secondary channel alongside Telegram
// ---------------------------------------------------------------------------

async function sendExpoPush(title, body) {
  const tokens = await store.pushTokens();
  if (tokens.length === 0) return;
  const messages = tokens.slice(0, 90).map((to) => ({ to, title, body, sound: 'default' }));
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    console.log(`[ScanServer] expo push -> ${tokens.length} devices, http ${res.status}`);
  } catch (e) {
    console.log('[ScanServer] expo push failed:', e);
  }
}

async function announce(cfg, text, title, body) {
  await sendTelegram(cfg, text);
  await sendExpoPush(title, body);
}

// ---------------------------------------------------------------------------
// Scan cycle
// ---------------------------------------------------------------------------

function boundKeys(map, cap) {
  const entries = Object.keys(map).slice(-cap);
  const bounded = {};
  for (const key of entries) bounded[key] = true;
  return bounded;
}

let scanInFlight = false;

async function runScanCycle(trigger) {
  if (scanInFlight) return { skipped: 'busy' };
  const cfg = await store.get('config');
  if (!cfg || !cfg.botToken || !cfg.chatId) return { skipped: 'no-config' };

  const hour = new Date().getUTCHours();
  const selected = cfg.gainzTimeframes ?? ['1d'];

  // Timeframes whose candle interval has elapsed since their last scan.
  // 15m/30m/1h/4h each get their own per-timeframe clock; 1d is handled by
  // dailyDue (once per UTC day).
  const now = Date.now();
  const lastTfAt = (await store.get('lastGainzTfAt')) ?? {};
  const tickTfs = selected.filter(
    (tf) => tf !== '1d' && GAINZ_TF_MS[tf] && now - (lastTfAt[tf] ?? 0) >= GAINZ_TF_MS[tf] - 30_000
  );

  const lastScanDate = (await store.get('lastScanDate')) ?? '';
  const dailyDue = trigger === 'manual' || lastScanDate !== utcDateStr();

  if (tickTfs.length === 0 && !dailyDue) return { skipped: 'not-due' };

  // Mark the due timeframes as scanned right away so a failing scan doesn't
  // trigger an every-tick retry storm; the next attempt waits a full interval.
  const markTfs = dailyDue ? selected.filter((tf) => tf !== '1d') : tickTfs;
  for (const tf of markTfs) lastTfAt[tf] = now;
  await store.put('lastGainzTfAt', lastTfAt);

  scanInFlight = true;
  try {
    let gainzNew = 0;
    let customNew = 0;
    let hookNew = 0;
    const marketSets = await getMarketSets();

    // --- GainzAlgo ---
    if (cfg.gainzAlgoEnabled && (dailyDue || tickTfs.length > 0)) {
      try {
        const tfs = dailyDue ? selected : tickTfs;
        const fresh = await scanGainzAlgo(tfs, marketSets);
        const stored = (await store.get('gainzSignals')) ?? [];
        const ids = new Set(stored.map((s) => s.id));
        const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 240);

        const keys = (await store.get('gainzNotifyKeys')) ?? {};
        const isFirstRun = Object.keys(keys).length === 0;
        const announceList = fresh.filter((s) => !keys[s.id]);
        for (const s of fresh) keys[s.id] = true;

        await store.put('gainzNotifyKeys', boundKeys(keys, 1000));
        await store.put('gainzSignals', merged);

        if (!isFirstRun && announceList.length > 0) {
          gainzNew = announceList.length;
          await announce(cfg, buildGainzText(announceList), '📊 GainzAlgo', `${announceList.length} سیگنال جدید اندیکاتور GainzAlgo`);
        }
        console.log(`[ScanServer] gainz cycle: ${fresh.length} current, ${gainzNew} new`);
      } catch (e) {
        console.log('[ScanServer] gainz scan failed:', e);
      }
    }

    // --- Custom indicators (scanned once per day / on catch-up) ---
    if (dailyDue) {
      const active = (cfg.indicators || []).filter((i) => i.receiveSignals && i.code.trim().length > 0);
      if (active.length > 0) {
        try {
          const { signals: fresh, errors } = await scanCustomIndicators(active, marketSets);
          await store.put('customErrors', errors);

          const stored = (await store.get('customSignals')) ?? [];
          const ids = new Set(stored.map((s) => s.id));
          const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 200);

          const keys = (await store.get('customNotifyKeys')) ?? {};
          const isFirstRun = Object.keys(keys).length === 0;
          const announceList = fresh.filter((s) => !keys[s.id]);
          for (const s of fresh) keys[s.id] = true;

          await store.put('customNotifyKeys', boundKeys(keys, 600));
          await store.put('customSignals', merged);

          if (!isFirstRun && announceList.length > 0) {
            customNew = announceList.length;
            await announce(cfg, buildCustomText(announceList), '🧩 اندیکاتور دستی', `${announceList.length} سیگنال جدید از اندیکاتورهای شما`);
          }
          console.log(`[ScanServer] custom cycle: ${fresh.length} current, ${customNew} new`);
        } catch (e) {
          console.log('[ScanServer] custom scan failed:', e);
        }
      }
    }

    // --- Hook Reversal ---
    if (cfg.hookEnabled) {
      const hookTfs = cfg.hookTimeframes ?? ['1d'];
      const lastHookAt = (await store.get('lastHookTfAt')) ?? {};
      const hookDueTfs = hookTfs.filter(
        (tf) => tf !== '1d' && GAINZ_TF_MS[tf] && now - (lastHookAt[tf] ?? 0) >= GAINZ_TF_MS[tf] - 30_000
      );
      if (dailyDue || hookDueTfs.length > 0) {
        try {
          const tfs = dailyDue ? hookTfs : hookDueTfs;
          const markHook = dailyDue ? hookTfs.filter((tf) => tf !== '1d') : hookDueTfs;
          for (const tf of markHook) lastHookAt[tf] = now;
          await store.put('lastHookTfAt', lastHookAt);
          const fresh = await scanHookReversal(tfs, marketSets);
          const stored = (await store.get('hookSignals')) ?? [];
          const ids = new Set(stored.map((s) => s.id));
          const merged = [...fresh.filter((s) => !ids.has(s.id)), ...stored].slice(0, 200);

          const keys = (await store.get('hookNotifyKeys')) ?? {};
          const isFirstRun = Object.keys(keys).length === 0;
          const announceList = fresh.filter((s) => !keys[s.id]);
          for (const s of fresh) keys[s.id] = true;

          await store.put('hookNotifyKeys', boundKeys(keys, 700));
          await store.put('hookSignals', merged);

          if (!isFirstRun && announceList.length > 0) {
            hookNew = announceList.length;
            await announce(cfg, buildHookText(announceList), '🪝 هوک ریورسال', `${announceList.length} هوک جدید شناسایی شد`);
          }
          console.log(`[ScanServer] hook cycle: ${fresh.length} current, ${hookNew} new`);
        } catch (e) {
          console.log('[ScanServer] hook scan failed:', e);
        }
      }
    }

    await store.put('lastScanAt', Date.now());
    if (dailyDue) await store.put('lastScanDate', utcDateStr());
    return { gainzNew, customNew, hookNew };
  } finally {
    scanInFlight = false;
  }
}

module.exports = {
  utcDateStr,
  msUntilNextUtcHour,
  runScanCycle,
  scanGainzAlgo,
  scanHookReversal,
  scanCustomIndicators,
  fetchTickers,
  sendTelegram,
  TF_LABEL,
  HOOK_TF_LABEL,
};
