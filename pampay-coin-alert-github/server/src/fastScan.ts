// server/src/fastScan.ts
// Fast-cycle server scanner (every ~10 minutes): pump/dump volume signals,
// meme-coin short signals and pre-listing candidates. Runs entirely on the
// server so alerts reach Telegram + push even when the phone app is closed.
//
// The pump/dump logic is a 1:1 port of the app-side scanner
// (utils/binanceApi.ts) with a server-side result cache so the app's home
// tab can reuse the exact same signals (GET /scan/pumpdump).

import store from "./store";
import { sendTelegram } from "./telegram";
import { sendPushToAll } from "./push";

// ---------------------------------------------------------------------------
// Binance helpers (futures first, spot fallback)
// ---------------------------------------------------------------------------

const FUTURES_BASE = "https://fapi.binance.com";
const SPOT_BASE = "https://api.binance.com";
let binanceBase: string | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

interface Ticker24 {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

async function fetchTickers(): Promise<Ticker24[]> {
  try {
    const data = await getJson<Ticker24[]>(`${FUTURES_BASE}/fapi/v1/ticker/24hr`);
    binanceBase = FUTURES_BASE;
    return data.filter((t) => t.symbol.endsWith("USDT"));
  } catch {
    const data = await getJson<Ticker24[]>(`${SPOT_BASE}/api/v3/ticker/24hr`);
    binanceBase = SPOT_BASE;
    return data.filter((t) => t.symbol.endsWith("USDT"));
  }
}

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<number[][]> {
  const base = binanceBase ?? FUTURES_BASE;
  const path = base === SPOT_BASE ? "/api/v3/klines" : "/fapi/v1/klines";
  return getJson<number[][]>(`${base}${path}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
}

function fetchTakerVolume(symbol: string): Promise<{ buyVol: number; sellVol: number }> {
  return fetchKlines(symbol, "5m", 12)
    .then((klines) => {
      let buyVol = 0;
      let totalVol = 0;
      for (const k of klines) {
        totalVol += parseFloat(String(k[5]));
        buyVol += parseFloat(String(k[9]));
      }
      return { buyVol, sellVol: totalVol - buyVol };
    })
    .catch(() => ({ buyVol: 0, sellVol: 0 }));
}

function fetchFundingRate(symbol: string): Promise<number> {
  return getJson<{ lastFundingRate?: string }>(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`)
    .then((d) => (d?.lastFundingRate ? parseFloat(d.lastFundingRate) : 0))
    .catch(() => 0);
}

// ---------------------------------------------------------------------------
// Pump / Dump scan (port of the client scanner)
// ---------------------------------------------------------------------------

export interface PumpDumpSignal {
  id: string;
  symbol: string;
  displayName: string;
  signalType: "pump" | "dump";
  currentPrice: number;
  priceChangePercent: number;
  volume24h: number;
  volumeChangeRatio: number;
  buyVolumeRatio: number;
  sellVolumeRatio: number;
  suggestedEntry: number;
  suggestedTarget: number;
  suggestedStopLoss: number;
  strength: "high" | "medium" | "low";
  reason: string;
  fundingRate: number;
  timeframe: string;
  detectedAt: number;
}

const STRENGTH_ORDER = { high: 0, medium: 1, low: 2 };

async function scanDirection(
  direction: "pump" | "dump",
  volumeThreshold: number,
  maxSymbols = 40
): Promise<PumpDumpSignal[]> {
  const tickers = await fetchTickers();
  const filtered = tickers.filter((t) => {
    const quoteVol = parseFloat(t.quoteVolume);
    const priceChange = parseFloat(t.priceChangePercent);
    if (quoteVol <= 5_000_000) return false;
    if (direction === "pump") return priceChange > -5 && priceChange < 15;
    return priceChange < 5 && priceChange > -15;
  });

  const topByVolume = filtered
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals: PumpDumpSignal[] = [];

  for (const ticker of topByVolume) {
    try {
      const klines = await fetchKlines(ticker.symbol, "1h", 24);
      if (klines.length < 12) continue;

      const recentVolumes = klines.slice(-4).map((k) => parseFloat(String(k[5])));
      const olderVolumes = klines.slice(-12, -4).map((k) => parseFloat(String(k[5])));
      const avgRecent = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const avgOlder = olderVolumes.reduce((a, b) => a + b, 0) / olderVolumes.length;
      const volumeRatio = avgOlder > 0 ? avgRecent / avgOlder : 0;
      if (volumeRatio < volumeThreshold) continue;

      const { buyVol, sellVol } = await fetchTakerVolume(ticker.symbol);
      const totalVol = buyVol + sellVol;
      const buyRatio = totalVol > 0 ? buyVol / totalVol : 0.5;
      const sellRatio = totalVol > 0 ? sellVol / totalVol : 0.5;

      if (direction === "pump" && buyRatio < 0.55) continue;
      if (direction === "dump" && sellRatio < 0.55) continue;

      const fundingRate = await fetchFundingRate(ticker.symbol);
      const currentPrice = parseFloat(ticker.lastPrice);
      const priceChange = parseFloat(ticker.priceChangePercent);

      let strength: "high" | "medium" | "low" = "low";
      let reason = "";

      if (direction === "pump") {
        if (volumeRatio > 3.5 && buyRatio > 0.65) strength = "high";
        else if (volumeRatio > 2.5 && buyRatio > 0.6) strength = "medium";
        reason =
          volumeRatio > 3
            ? `حجم معاملات ${volumeRatio.toFixed(1)} برابر میانگین شده`
            : `افزایش ${volumeRatio.toFixed(1)} برابری حجم`;
        reason +=
          buyRatio > 0.65
            ? ` • خریداران ${(buyRatio * 100).toFixed(0)}% بازار`
            : ` • نسبت خرید ${(buyRatio * 100).toFixed(0)}%`;
      } else {
        if (volumeRatio > 3.5 && sellRatio > 0.65) strength = "high";
        else if (volumeRatio > 2.5 && sellRatio > 0.6) strength = "medium";
        reason =
          volumeRatio > 3
            ? `حجم فروش ${volumeRatio.toFixed(1)} برابر میانگین شده`
            : `افزایش ${volumeRatio.toFixed(1)} برابری حجم فروش`;
        reason +=
          sellRatio > 0.65
            ? ` • فروشندگان ${(sellRatio * 100).toFixed(0)}% بازار`
            : ` • نسبت فروش ${(sellRatio * 100).toFixed(0)}%`;
      }

      const dir = direction === "pump" ? 1 : -1;
      const targetPct = strength === "high" ? 0.05 : strength === "medium" ? 0.03 : 0.02;

      signals.push({
        id: `pd-${direction}-${ticker.symbol}-${Math.floor(Date.now() / (2 * 3600_000))}`,
        symbol: ticker.symbol,
        displayName: ticker.symbol.replace("USDT", "") + "/USDT",
        signalType: direction,
        currentPrice,
        priceChangePercent: priceChange,
        volume24h: parseFloat(ticker.quoteVolume),
        volumeChangeRatio: volumeRatio,
        buyVolumeRatio: buyRatio,
        sellVolumeRatio: sellRatio,
        suggestedEntry: currentPrice,
        suggestedTarget: currentPrice * (1 + dir * targetPct),
        suggestedStopLoss: currentPrice * (1 - dir * 0.015),
        strength,
        reason,
        fundingRate,
        timeframe: "1h",
        detectedAt: Date.now(),
      });
    } catch (e) {
      console.log(`[FastScan] ${direction} kline error ${ticker.symbol}:`, e);
    }
  }

  signals.sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);
  return signals;
}

// 90-second in-memory cache so the app's frequent home-tab scans don't
// hammer Binance.
let pumpDumpCache: { at: number; threshold: number; signals: PumpDumpSignal[] } | null = null;

export async function runPumpDumpScan(volumeThreshold: number): Promise<PumpDumpSignal[]> {
  if (pumpDumpCache && Date.now() - pumpDumpCache.at < 90_000 && pumpDumpCache.threshold === volumeThreshold) {
    return pumpDumpCache.signals;
  }
  const [pump, dump] = await Promise.all([
    scanDirection("pump", volumeThreshold),
    scanDirection("dump", volumeThreshold),
  ]);
  const all = [...pump, ...dump].sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);
  pumpDumpCache = { at: Date.now(), threshold: volumeThreshold, signals: all };
  return all;
}

function buildPumpDumpText(signals: PumpDumpSignal[]): string {
  const lines = ["📡 <b>اسکنر پامپ / دامپ</b>", "🖥 <i>اسکن خودکار سرور — تایم‌فریم ۱ ساعته</i>\n"];
  const pumps = signals.filter((s) => s.signalType === "pump");
  const dumps = signals.filter((s) => s.signalType === "dump");

  if (pumps.length > 0) {
    lines.push(`🟢 <b>سیگنال پامپ (${pumps.length})</b>`);
    for (const s of pumps) {
      lines.push(
        `🚀 <b>${s.displayName}</b> — پامپ`,
        `   💰 قیمت: $${s.currentPrice < 1 ? s.currentPrice.toPrecision(4) : s.currentPrice.toFixed(2)} | تغییر ۲۴س: ${s.priceChangePercent.toFixed(1)}%`,
        `   📊 حجم: ${s.volumeChangeRatio.toFixed(1)}x میانگین | خرید: ${(s.buyVolumeRatio * 100).toFixed(0)}%`,
        `   ${s.reason}`,
        `   🎯 هدف: $${s.suggestedTarget.toFixed(s.suggestedTarget < 1 ? 6 : 2)} | حد ضرر: $${s.suggestedStopLoss.toFixed(s.suggestedStopLoss < 1 ? 6 : 2)}${s.fundingRate !== 0 ? ` | فاندینگ: ${(s.fundingRate * 100).toFixed(3)}%` : ""}`,
        `   ⚡ قدرت: ${s.strength === "high" ? "قوی" : s.strength === "medium" ? "متوسط" : "ضعیف"}`,
        ""
      );
    }
  }
  if (dumps.length > 0) {
    lines.push(`🔴 <b>سیگنال دامپ (${dumps.length})</b>`);
    for (const s of dumps) {
      lines.push(
        `📉 <b>${s.displayName}</b> — دامپ`,
        `   💰 قیمت: $${s.currentPrice < 1 ? s.currentPrice.toPrecision(4) : s.currentPrice.toFixed(2)} | تغییر ۲۴س: ${s.priceChangePercent.toFixed(1)}%`,
        `   📊 حجم: ${s.volumeChangeRatio.toFixed(1)}x میانگین | فروش: ${(s.sellVolumeRatio * 100).toFixed(0)}%`,
        `   ${s.reason}`,
        `   🎯 هدف: $${s.suggestedTarget.toFixed(s.suggestedTarget < 1 ? 6 : 2)} | حد ضرر: $${s.suggestedStopLoss.toFixed(s.suggestedStopLoss < 1 ? 6 : 2)}${s.fundingRate !== 0 ? ` | فاندینگ: ${(s.fundingRate * 100).toFixed(3)}%` : ""}`,
        `   ⚡ قدرت: ${s.strength === "high" ? "قوی" : s.strength === "medium" ? "متوسط" : "ضعیف"}`,
        ""
      );
    }
  }
  if (signals.length === 0) lines.push("📭 در این اسکن سیگنالی یافت نشد.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Meme short scan (port of utils/memeApiService.ts, confidence >= 70)
// ---------------------------------------------------------------------------

const DEXSCREENER_BASE = "https://api.dexscreener.com";

interface DexPair {
  chainId: string;
  pairAddress: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  txns?: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  volume?: { h1: number; h6: number; h24: number };
  priceChange?: { h1: number; h6: number; h24: number };
  liquidity?: { usd: number };
  fdv?: number;
  pairCreatedAt?: number;
}

export interface MemeSignal {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  confidence: number;
  levelText: string;
  recommendedLeverage: number;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  dexUrl: string;
  contractAddress: string;
  detectedAt: number;
}

const CHAIN_FILTER = new Set(["solana", "ethereum", "bsc", "base"]);

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function memeShortScore(pair: DexPair): { confidence: number; levelText: string; leverage: number } {
  const h24 = pair.priceChange?.h24 ?? 0;
  const h1 = pair.priceChange?.h1 ?? 0;
  const h6 = pair.priceChange?.h6 ?? 0;
  const liq = pair.liquidity?.usd ?? 0;
  const fdv = pair.fdv ?? 0;

  let technical = 50;
  if (h24 > 500) technical += 20;
  else if (h24 > 200) technical += 15;
  else if (h24 > 100) technical += 10;
  if (h1 < -5 && h24 > 100) technical += 15;
  else if (h1 < 0 && h24 > 50) technical += 8;
  if (h6 < h24 * 0.3 && h24 > 100) technical += 10;

  let onchain = 50;
  const sells = pair.txns?.h24?.sells ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sellRatio = sells / Math.max(1, buys);
  if (sellRatio > 2) onchain += 20;
  else if (sellRatio > 1.5) onchain += 12;
  else if (sellRatio > 1.2) onchain += 5;
  if (liq < 100_000) onchain += 15;
  else if (liq < 500_000) onchain += 8;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600_000 : Infinity;
  if (ageHours < 24) onchain += 10;
  else if (ageHours < 72) onchain += 5;

  let sentiment = 50;
  if (h1 < -10) sentiment += 15;
  const volH1 = pair.volume?.h1 ?? 0;
  const volH24 = pair.volume?.h24 ?? 0;
  if (volH24 > 0 && volH1 < (volH24 / 24) * 0.5) sentiment += 12;
  if (h6 < 0 && h24 > 100) sentiment += 10;

  let derivatives = 50;
  if (h24 > 300) derivatives += 15;
  if ((pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0) > 500) derivatives += 10;
  if (h24 > 200 && h1 < 0) derivatives += 12;

  let hype = 50;
  if (h24 > 500 && h1 < 5) hype += 25;
  else if (h24 > 200 && h1 < 10) hype += 15;
  if (fdv > 10_000_000 && fdv < 50_000_000) hype += 8;
  else if (fdv > 50_000_000) hype += 5;
  const volToMcap = volH24 / Math.max(1, fdv);
  if (volToMcap > 2) hype += 10;

  const confidence = clamp100(
    technical * 0.3 + onchain * 0.25 + sentiment * 0.2 + derivatives * 0.15 + hype * 0.1
  );

  let levelText = "اجتناب — صبر کنید";
  let leverage = 0;
  if (confidence >= 80) {
    levelText = "سل قوی (High Conviction Short)";
    leverage = 3;
  } else if (confidence >= 65) {
    levelText = "سل متوسط — فقط با ۲x";
    leverage = 2;
  } else if (confidence >= 50) {
    levelText = "ضعیف — صبر کنید";
    leverage = 1;
  }
  return { confidence: Math.round(confidence * 10) / 10, levelText, leverage };
}

async function fetchDexJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function runMemeScan(): Promise<MemeSignal[]> {
  const [boosted, search] = await Promise.all([
    fetchDexJson<{ tokenAddress: string }[]>(`${DEXSCREENER_BASE}/token-boosts/latest/v1`),
    fetchDexJson<{ pairs: DexPair[] }>(`${DEXSCREENER_BASE}/latest/dex/search?q=meme`),
  ]);

  const addresses = (Array.isArray(boosted) ? boosted : [])
    .slice(0, 12)
    .map((t) => t.tokenAddress)
    .filter(Boolean);

  const boostedPairs: DexPair[] = [];
  for (const addr of addresses.slice(0, 10)) {
    const data = await fetchDexJson<{ pairs: DexPair[] }>(`${DEXSCREENER_BASE}/latest/dex/tokens/${addr}`);
    if (data?.pairs) boostedPairs.push(...data.pairs);
  }

  const allPairs = [...boostedPairs, ...(search?.pairs ?? [])];
  const seen = new Set<string>();
  const unique = allPairs.filter((p) => {
    const key = `${p.chainId}-${p.pairAddress}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const signals: MemeSignal[] = [];
  for (const pair of unique) {
    if (!CHAIN_FILTER.has(pair.chainId)) continue;
    const h24 = pair.priceChange?.h24 ?? 0;
    const vol = pair.volume?.h24 ?? 0;
    const liq = pair.liquidity?.usd ?? 0;
    const fdv = pair.fdv ?? 0;
    if (h24 < 100 || vol < 50_000 || liq < 10_000 || fdv > 50_000_000 || fdv < 100_000) continue;

    const price = parseFloat(pair.priceUsd ?? "0");
    if (price <= 0) continue;

    const score = memeShortScore(pair);
    if (score.confidence < 70) continue;

    signals.push({
      id: `${pair.chainId}-${pair.pairAddress}`,
      name: pair.baseToken?.name ?? "Unknown",
      symbol: pair.baseToken?.symbol ?? "???",
      chain: pair.chainId,
      currentPrice: price,
      priceChange24h: h24,
      volume24h: vol,
      liquidity: liq,
      marketCap: fdv,
      confidence: score.confidence,
      levelText: score.levelText,
      recommendedLeverage: score.leverage,
      entry: price,
      target1: price * 0.8,
      target2: price * 0.6,
      stopLoss: price * 1.12,
      dexUrl: pair.url ?? "",
      contractAddress: pair.baseToken?.address ?? "",
      detectedAt: Date.now(),
    });
  }

  signals.sort((a, b) => b.confidence - a.confidence);
  return signals.slice(0, 15);
}

function buildMemeText(signals: MemeSignal[]): string {
  const lines = [
    "🎯 <b>شورت میم‌کوین</b>",
    "🖥 <i>اسکن خودکار سرور (DexScreener)</i>\n",
  ];
  const chainLabel: Record<string, string> = {
    solana: "سولانا",
    ethereum: "اتریوم",
    bsc: "BSC",
    base: "بیس",
  };
  for (const s of signals) {
    lines.push(
      `⚠️ <b>${s.symbol}</b> (${s.name}) — شبکه ${chainLabel[s.chain] ?? s.chain}`,
      `   🎯 اطمینان شورت: ${s.confidence}% — ${s.levelText}`,
      `   💰 قیمت: $${s.currentPrice.toPrecision(4)} | پامپ ۲۴س: ${s.priceChange24h.toFixed(0)}%`,
      `   💧 لیکوییدیتی: $${(s.liquidity / 1000).toFixed(0)}K | مارکت‌کپ: $${(s.marketCap / 1_000_000).toFixed(1)}M`,
      `   📉 ورود: $${s.entry.toPrecision(4)} | هدف۱: $${s.target1.toPrecision(4)} | هدف۲: $${s.target2.toPrecision(4)} | حد ضرر: $${s.stopLoss.toPrecision(4)}`,
      `   🏷 اهرم پیشنهادی: ${s.recommendedLeverage}x`,
      s.dexUrl ? `   🔗 ${s.dexUrl}` : "",
      ""
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pre-listing scan (port of app/(tabs)/pre-listing)
// ---------------------------------------------------------------------------

export interface PreListingSignal {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  contractAddress: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  listingConf: number;
  expectedExchange: string;
  expectedListingDate: string;
  isScam: boolean;
  scamReason: string;
  dexUrl: string;
  detectedAt: number;
}

export async function runPreListingScan(): Promise<PreListingSignal[]> {
  const [boosted, trend] = await Promise.all([
    fetchDexJson<{ tokenAddress: string }[]>(`${DEXSCREENER_BASE}/token-boosts/latest/v1`),
    fetchDexJson<{ pairs: DexPair[] }>(`${DEXSCREENER_BASE}/latest/dex/search?q=new+launch+meme`),
  ]);

  const addresses = (Array.isArray(boosted) ? boosted : []).slice(0, 10).map((t) => t.tokenAddress).filter(Boolean);
  const boostedPairs: DexPair[] = [];
  for (const addr of addresses.slice(0, 5)) {
    const data = await fetchDexJson<{ pairs: DexPair[] }>(`${DEXSCREENER_BASE}/latest/dex/tokens/${addr}`);
    if (data?.pairs) boostedPairs.push(...data.pairs);
  }

  const allPairs = [...boostedPairs, ...(trend?.pairs ?? [])];
  const seen = new Set<string>();
  const unique = allPairs.filter((p) => {
    const key = `${p.chainId}-${p.pairAddress}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tokens: PreListingSignal[] = [];
  for (const pair of unique) {
    const fdv = pair.fdv ?? 0;
    const vol = pair.volume?.h24 ?? 0;
    const liq = pair.liquidity?.usd ?? 0;
    const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600_000 : Infinity;
    if (!(fdv > 100_000 && fdv < 100_000_000 && vol > 10_000 && liq > 5000 && ageHours < 168)) continue;

    const price = parseFloat(pair.priceUsd ?? "0");
    const change24 = pair.priceChange?.h24 ?? 0;
    const sells = pair.txns?.h24?.sells ?? 0;
    const buys = pair.txns?.h24?.buys ?? 0;
    const sellRatio = sells / Math.max(1, buys);
    const hasSocials = false; // info field not fetched in server port

    let listingConf = 30;
    if (fdv > 5_000_000) listingConf += 20;
    else if (fdv > 1_000_000) listingConf += 10;
    if (vol > 1_000_000) listingConf += 15;
    else if (vol > 500_000) listingConf += 10;
    if (hasSocials) listingConf += 10;
    if (change24 > 100) listingConf += 10;
    if (liq > 100_000) listingConf += 5;
    listingConf = Math.min(95, listingConf);

    let isScam = false;
    let scamReason = "";
    if (liq < 10_000 && fdv > 5_000_000) {
      isScam = true;
      scamReason = "لیکوییدیتی بسیار پایین نسبت به مارکت‌کپ";
    }
    if (sellRatio > 3) {
      isScam = true;
      scamReason = "فروش‌ها بسیار بیشتر از خریدها (احتمال راگ)";
    }

    let expectedExchange = "نامشخص";
    if (fdv > 50_000_000 && vol > 5_000_000) expectedExchange = "بایننس / بای‌بیت";
    else if (fdv > 10_000_000 && vol > 1_000_000) expectedExchange = "بای‌بیت / OKX / MEXC";
    else if (fdv > 5_000_000) expectedExchange = "MEXC / Gate.io / Bitget";
    else if (fdv > 1_000_000) expectedExchange = "MEXC / Gate.io / LBank";
    else expectedExchange = "صرافی‌های کوچک‌تر";

    let expectedDate = "احتمال کم";
    if (listingConf > 70) {
      const days = Math.max(1, Math.round(7 - (listingConf - 70) / 10));
      expectedDate = `حدود ${new Date(Date.now() + days * 86400_000).toLocaleDateString("fa-IR")}`;
    } else if (listingConf > 50) {
      expectedDate = "۱-۲ هفته آینده";
    }

    tokens.push({
      id: `pre-${pair.chainId}-${pair.pairAddress}`,
      name: pair.baseToken?.name ?? "Unknown",
      symbol: pair.baseToken?.symbol ?? "???",
      chain: pair.chainId ?? "solana",
      contractAddress: pair.baseToken?.address ?? "",
      currentPrice: price,
      priceChange24h: change24,
      volume24h: vol,
      marketCap: fdv,
      liquidity: liq,
      listingConf,
      expectedExchange,
      expectedListingDate: expectedDate,
      isScam,
      scamReason,
      dexUrl: pair.url ?? "",
      detectedAt: Date.now(),
    });
  }

  tokens.sort((a, b) => b.listingConf - a.listingConf);
  return tokens.slice(0, 10);
}

function buildPreListingText(tokens: PreListingSignal[]): string {
  const lines = ["🚀 <b>قبل از پامپ — کاندیدای لیست‌شدن</b>", "🖥 <i>اسکن خودکار سرور (DexScreener)</i>\n"];
  for (const t of tokens) {
    const scam = t.isScam ? `\n   🚨 ریسک کلاهبرداری: ${t.scamReason}` : "";
    lines.push(
      `📌 <b>${t.symbol}</b> (${t.name}) — شبکه ${t.chain}`,
      `   💰 مارکت‌کپ: $${(t.marketCap / 1_000_000).toFixed(1)}M | حجم ۲۴س: $${(t.volume24h / 1000).toFixed(0)}K | لیکوییدیتی: $${(t.liquidity / 1000).toFixed(0)}K`,
      `   📈 تغییر ۲۴س: ${t.priceChange24h.toFixed(0)}%`,
      `   🏦 صرافی محتمل: ${t.expectedExchange} | ${t.expectedListingDate}`,
      `   🎯 احتمال لیست‌شدن: ${t.listingConf}%${scam}`,
      t.dexUrl ? `   🔗 ${t.dexUrl}` : "",
      ""
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The fast cycle (called every ~10 minutes)
// ---------------------------------------------------------------------------

export interface FastScanFlags {
  scannerEnabled?: boolean;
  memeEnabled?: boolean;
  preListingEnabled?: boolean;
  volumeThreshold?: number;
}

interface FastScanConfig extends FastScanFlags {
  botToken?: string;
  chatId?: string;
}

function boundKeys(map: Record<string, boolean>, cap: number): Record<string, boolean> {
  const entries = Object.keys(map).slice(-cap);
  const bounded: Record<string, boolean> = {};
  for (const key of entries) bounded[key] = true;
  return bounded;
}

let fastInFlight = false;

export async function runFastScanCycle(trigger: "timer" | "manual"): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  if (fastInFlight) return { skipped: 1 };
  const cfg = (await store.get<FastScanConfig>("config")) ?? {};
  if (!cfg.botToken || !cfg.chatId) return { noConfig: 1 };

  fastInFlight = true;
  try {
    const target = { botToken: cfg.botToken, chatId: cfg.chatId };

    // --- Pump / Dump scanner ---
    if (cfg.scannerEnabled !== false) {
      try {
        const signals = await runPumpDumpScan(cfg.volumeThreshold ?? 2.0);
        const keys = (await store.get<Record<string, boolean>>("pumpDumpNotifyKeys")) ?? {};
        const isFirstRun = Object.keys(keys).length === 0;
        const announce = signals.filter((s) => !keys[s.id]);
        for (const s of signals) keys[s.id] = true;
        await store.put("pumpDumpNotifyKeys", boundKeys(keys, 300));
        await store.put("pumpDumpSignals", signals.slice(0, 100));

        if (!isFirstRun && announce.length > 0) {
          summary.pumpDumpNew = announce.length;
          await sendTelegram(target, buildPumpDumpText(announce));
          const pumps = announce.filter((s) => s.signalType === "pump").length;
          await sendPushToAll(
            "📡 سیگنال پامپ/دامپ",
            `${pumps > 0 ? `🚀 ${pumps} پامپ` : ""}${pumps > 0 && announce.length - pumps > 0 ? " و " : ""}${announce.length - pumps > 0 ? `📉 ${announce.length - pumps} دامپ` : ""} جدید — اسکنر سرور`,
            { kind: "pumpdump", count: announce.length }
          );
        }
        console.log(`[FastScan] pump/dump cycle (${trigger}): ${signals.length} current, ${summary.pumpDumpNew ?? 0} new`);
      } catch (e) {
        console.log("[FastScan] pump/dump failed:", e);
      }
    }

    // --- Meme short scanner ---
    if (cfg.memeEnabled !== false) {
      try {
        const signals = await runMemeScan();
        const keys = (await store.get<Record<string, boolean>>("memeNotifyKeys")) ?? {};
        const isFirstRun = Object.keys(keys).length === 0;
        const announce = signals.filter((s) => !keys[s.id]);
        for (const s of signals) keys[s.id] = true;
        await store.put("memeNotifyKeys", boundKeys(keys, 200));
        await store.put("memeSignals", signals);

        if (!isFirstRun && announce.length > 0) {
          summary.memeNew = announce.length;
          await sendTelegram(target, buildMemeText(announce));
          await sendPushToAll(
            "🎯 شورت میم‌کوین",
            `⚠️ ${announce[0].symbol} اطمینان ${announce[0].confidence}%${announce.length > 1 ? ` +${announce.length - 1} مورد دیگر` : ""}`,
            { kind: "meme", count: announce.length }
          );
        }
        console.log(`[FastScan] meme cycle (${trigger}): ${signals.length} current, ${summary.memeNew ?? 0} new`);
      } catch (e) {
        console.log("[FastScan] meme failed:", e);
      }
    }

    // --- Pre-listing candidates ---
    if (cfg.preListingEnabled !== false) {
      try {
        const tokens = await runPreListingScan();
        const keys = (await store.get<Record<string, boolean>>("preListingNotifyKeys")) ?? {};
        const isFirstRun = Object.keys(keys).length === 0;
        const announce = tokens.filter((t) => !keys[t.id]);
        for (const t of tokens) keys[t.id] = true;
        await store.put("preListingNotifyKeys", boundKeys(keys, 200));
        await store.put("preListingSignals", tokens);

        if (!isFirstRun && announce.length > 0) {
          summary.preListingNew = announce.length;
          await sendTelegram(target, buildPreListingText(announce));
          await sendPushToAll(
            "🚀 کاندیدای لیست‌شدن",
            `📌 ${announce[0].symbol} — احتمال ${announce[0].listingConf}%${announce.length > 1 ? ` +${announce.length - 1} مورد دیگر` : ""}`,
            { kind: "prelisting", count: announce.length }
          );
        }
        console.log(`[FastScan] pre-listing cycle (${trigger}): ${tokens.length} current, ${summary.preListingNew ?? 0} new`);
      } catch (e) {
        console.log("[FastScan] pre-listing failed:", e);
      }
    }

    await store.put("lastFastScanAt", Date.now());
    return summary;
  } finally {
    fastInFlight = false;
  }
}

/** Latest pump/dump signals for the app (GET /scan/pumpdump). */
export async function pumpDumpResponse(thresholdOverride?: number): Promise<Record<string, unknown>> {
  const cfg = (await store.get<FastScanConfig>("config")) ?? {};
  const threshold =
    typeof thresholdOverride === "number" && thresholdOverride >= 1 && thresholdOverride <= 10
      ? thresholdOverride
      : (cfg.volumeThreshold ?? 2.0);
  let signals: PumpDumpSignal[] | null = null;
  try {
    signals = await runPumpDumpScan(threshold);
  } catch {
    signals = (await store.get<PumpDumpSignal[]>("pumpDumpSignals")) ?? [];
  }
  return {
    ok: true,
    signals,
    threshold,
    lastFastScanAt: (await store.get<number>("lastFastScanAt")) ?? null,
  };
}
