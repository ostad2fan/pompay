import {
  MemeToken,
  MemeShortSignal,
  MemeShortBreakdown,
  MemeExchangeAvailability,
  MemeScannerFilter,
  DEFAULT_MEME_FILTER,
} from '@/types/memeScanner';
import { ExchangeId } from '@/types/crypto';
import { EXCHANGES } from '@/constants/exchanges';

const DEXSCREENER_BASE = 'https://api.dexscreener.com';
const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const COINGLASS_BASE = 'https://open-api.coinglass.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[];
}

interface DexScreenerBoostToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  name?: string;
  symbol?: string;
  description?: string;
  amount: number;
  totalAmount: number;
}

const CHAIN_MAP: Record<string, MemeToken['chain']> = {
  solana: 'solana',
  ethereum: 'ethereum',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
};

function mapChainId(chainId: string): MemeToken['chain'] {
  return CHAIN_MAP[chainId] ?? 'solana';
}

const CEX_MEME_SYMBOLS: Record<string, ExchangeId[]> = {
  PEPE: ['binance', 'bybit', 'okx', 'kucoin', 'mexc', 'bitget', 'gateio'],
  DOGE: ['binance', 'bybit', 'okx', 'kucoin', 'mexc', 'bitget', 'gateio', 'htx'],
  SHIB: ['binance', 'bybit', 'okx', 'kucoin', 'mexc', 'bitget', 'gateio'],
  FLOKI: ['binance', 'bybit', 'okx', 'mexc', 'bitget', 'gateio'],
  WIF: ['binance', 'bybit', 'okx', 'mexc', 'bitget'],
  BONK: ['binance', 'bybit', 'okx', 'mexc', 'bitget', 'gateio'],
  MEME: ['binance', 'bybit', 'okx', 'mexc'],
  PEOPLE: ['binance', 'bybit', 'okx', 'mexc'],
  TURBO: ['binance', 'bybit', 'mexc', 'bitget'],
  NEIRO: ['binance', 'bybit', 'okx', 'mexc'],
  BOME: ['binance', 'bybit', 'mexc', 'bitget'],
  MEW: ['bybit', 'mexc', 'bitget', 'gateio'],
  POPCAT: ['binance', 'bybit', 'okx', 'mexc'],
  MYRO: ['mexc', 'bitget', 'gateio'],
  BRETT: ['bybit', 'mexc', 'bitget'],
  MOG: ['bybit', 'mexc', 'bitget'],
  SPX: ['mexc', 'bitget'],
};

function findExchangeAvailability(symbol: string): MemeExchangeAvailability[] {
  const upperSymbol = symbol.toUpperCase();
  const results: MemeExchangeAvailability[] = [];

  const matchedKey = Object.keys(CEX_MEME_SYMBOLS).find(
    (k) => upperSymbol.includes(k) || k.includes(upperSymbol)
  );

  if (matchedKey && CEX_MEME_SYMBOLS[matchedKey]) {
    for (const exId of CEX_MEME_SYMBOLS[matchedKey]) {
      const exchange = EXCHANGES[exId];
      if (exchange) {
        results.push({
          exchangeId: exId,
          exchangeName: exchange.name,
          hasFutures: true,
          symbol: `${matchedKey}USDT`,
        });
      }
    }
  }

  return results;
}

export async function fetchDexScreenerBoostedTokens(): Promise<DexScreenerBoostToken[]> {
  try {
    console.log('[MemeAPI] Fetching DexScreener boosted tokens...');
    const response = await fetch(`${DEXSCREENER_BASE}/token-boosts/latest/v1`);
    if (!response.ok) throw new Error(`DexScreener boost API error: ${response.status}`);
    const data = await response.json();
    console.log(`[MemeAPI] Got ${data?.length ?? 0} boosted tokens`);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.log('[MemeAPI] Error fetching boosted tokens:', error);
    return [];
  }
}

export async function fetchDexScreenerTopGainers(): Promise<DexScreenerPair[]> {
  try {
    console.log('[MemeAPI] Fetching DexScreener gainers...');
    const response = await fetch(`${DEXSCREENER_BASE}/latest/dex/search?q=meme`);
    if (!response.ok) throw new Error(`DexScreener search error: ${response.status}`);
    const data: DexScreenerResponse = await response.json();
    console.log(`[MemeAPI] Got ${data.pairs?.length ?? 0} pairs from search`);
    return data.pairs ?? [];
  } catch (error) {
    console.log('[MemeAPI] Error fetching gainers:', error);
    return [];
  }
}

export async function fetchDexScreenerByChain(chain: string): Promise<DexScreenerPair[]> {
  try {
    console.log(`[MemeAPI] Fetching DexScreener pairs for chain: ${chain}...`);
    const response = await fetch(
      `${DEXSCREENER_BASE}/latest/dex/search?q=pump+meme+${chain}`
    );
    if (!response.ok) throw new Error(`DexScreener chain API error: ${response.status}`);
    const data: DexScreenerResponse = await response.json();
    return data.pairs ?? [];
  } catch (error) {
    console.log(`[MemeAPI] Error fetching ${chain} pairs:`, error);
    return [];
  }
}

export async function fetchTokenByAddress(address: string): Promise<DexScreenerPair[]> {
  try {
    console.log(`[MemeAPI] Fetching token by address: ${address}...`);
    const response = await fetch(`${DEXSCREENER_BASE}/latest/dex/tokens/${address}`);
    if (!response.ok) throw new Error(`DexScreener token API error: ${response.status}`);
    const data: DexScreenerResponse = await response.json();
    return data.pairs ?? [];
  } catch (error) {
    console.log(`[MemeAPI] Error fetching token by address:`, error);
    return [];
  }
}

export async function fetchCoinGlassFundingRate(symbol: string): Promise<number> {
  try {
    const response = await fetch(
      `${COINGLASS_BASE}/public/v2/funding?symbol=${symbol}&time_type=h8`
    );
    if (!response.ok) return 0;
    const data = await response.json();
    if (data?.data?.[0]?.uMarginList?.[0]?.rate) {
      return parseFloat(data.data[0].uMarginList[0].rate);
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function fetchCoinGeckoTrending(): Promise<any[]> {
  try {
    console.log('[MemeAPI] Fetching CoinGecko trending...');
    const response = await fetch(`${COINGECKO_BASE}/search/trending`);
    if (!response.ok) return [];
    const data = await response.json();
    return data?.coins ?? [];
  } catch {
    return [];
  }
}

function calculateMemeShortScore(
  technicalScore: number,
  onchainScore: number,
  sentimentFade: number,
  derivativesScore: number,
  memeHypeFactor: number
): MemeShortSignal {
  const weights = {
    technical: 0.30,
    onchain: 0.25,
    sentimentFade: 0.20,
    derivatives: 0.15,
    memeHype: 0.10,
  };

  const base =
    technicalScore * weights.technical +
    onchainScore * weights.onchain +
    sentimentFade * weights.sentimentFade +
    derivativesScore * weights.derivatives +
    memeHypeFactor * weights.memeHype;

  const confidence = Math.max(0, Math.min(100, base));

  let level: MemeShortSignal['level'];
  let levelText: string;
  let recommendedLeverage: number;
  let recommendation: string;

  if (confidence >= 80) {
    level = 'strong';
    levelText = 'سل قوی (High Conviction Short)';
    recommendedLeverage = 3;
    recommendation = 'شورت فوری – انتظار ریزش سریع به خاطر liquidity پایین';
  } else if (confidence >= 65) {
    level = 'medium';
    levelText = 'سل متوسط – فقط با ۲x';
    recommendedLeverage = 2;
    recommendation = 'شورت با احتیاط – منتظر تأیید بیشتر باشید';
  } else if (confidence >= 50) {
    level = 'weak';
    levelText = 'ضعیف – صبر کنید';
    recommendedLeverage = 1;
    recommendation = 'فقط مشاهده – ورود پرریسک';
  } else {
    level = 'avoid';
    levelText = 'اجتناب – صبر کنید';
    recommendedLeverage = 0;
    recommendation = 'اجتناب – احتمالاً خلاف جهت بازار';
  }

  return {
    confidence: Math.round(confidence * 10) / 10,
    level,
    levelText,
    recommendedLeverage,
    entry: 0,
    target1: 0,
    target2: 0,
    stopLoss: 0,
    riskReward: 0,
    recommendation,
    breakdown: {
      technical: { score: technicalScore, weight: weights.technical, details: [] },
      onchain: { score: onchainScore, weight: weights.onchain, details: [] },
      sentimentFade: { score: sentimentFade, weight: weights.sentimentFade, details: [] },
      derivatives: { score: derivativesScore, weight: weights.derivatives, details: [] },
      memeHype: { score: memeHypeFactor, weight: weights.memeHype, details: [] },
    },
  };
}

function analyzeTechnical(pair: DexScreenerPair): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;

  const priceChange1h = pair.priceChange?.h1 ?? 0;
  const priceChange6h = pair.priceChange?.h6 ?? 0;
  const priceChange24h = pair.priceChange?.h24 ?? 0;

  if (priceChange24h > 500) {
    score += 20;
    details.push(`پامپ شدید ۲۴ ساعته: ${priceChange24h.toFixed(0)}٪ (اشباع خرید)`);
  } else if (priceChange24h > 200) {
    score += 15;
    details.push(`پامپ بالا ۲۴ ساعته: ${priceChange24h.toFixed(0)}٪`);
  } else if (priceChange24h > 100) {
    score += 10;
    details.push(`رشد قابل توجه: ${priceChange24h.toFixed(0)}٪`);
  }

  if (priceChange1h < -5 && priceChange24h > 100) {
    score += 15;
    details.push(`شروع ریزش ۱ ساعته: ${priceChange1h.toFixed(1)}٪ (واگرایی نزولی)`);
  } else if (priceChange1h < 0 && priceChange24h > 50) {
    score += 8;
    details.push(`مومنتوم در حال ضعیف شدن: ۱ ساعته ${priceChange1h.toFixed(1)}٪`);
  }

  if (priceChange6h < priceChange24h * 0.3 && priceChange24h > 100) {
    score += 10;
    details.push('کاهش سرعت رشد در ۶ ساعت اخیر');
  }

  const sellPressure1h = pair.txns?.h1 ? pair.txns.h1.sells / Math.max(1, pair.txns.h1.buys) : 0;
  if (sellPressure1h > 1.5) {
    score += 12;
    details.push(`فشار فروش ۱ ساعته: فروش ${sellPressure1h.toFixed(1)}x خرید`);
  } else if (sellPressure1h > 1.2) {
    score += 6;
    details.push(`فروش بیشتر از خرید در ۱ ساعت اخیر`);
  }

  const volumeH1 = pair.volume?.h1 ?? 0;
  const volumeH6 = pair.volume?.h6 ?? 0;
  if (volumeH6 > 0 && volumeH1 < volumeH6 / 6 * 0.5) {
    score += 8;
    details.push('کاهش حجم معاملات نسبت به میانگین ۶ ساعته');
  }

  return { score: Math.min(100, score), details };
}

function analyzeOnchain(pair: DexScreenerPair): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;

  const sells24h = pair.txns?.h24?.sells ?? 0;
  const buys24h = pair.txns?.h24?.buys ?? 0;
  const sellRatio = sells24h / Math.max(1, buys24h);

  if (sellRatio > 2) {
    score += 20;
    details.push(`فروش‌ها ${sellRatio.toFixed(1)}x بیشتر از خرید‌ها (۲۴ ساعته)`);
  } else if (sellRatio > 1.5) {
    score += 12;
    details.push(`نسبت فروش/خرید بالا: ${sellRatio.toFixed(1)}x`);
  } else if (sellRatio > 1.2) {
    score += 5;
    details.push(`فروش اندکی بیشتر از خرید`);
  }

  const liquidity = pair.liquidity?.usd ?? 0;
  if (liquidity < 100000) {
    score += 15;
    details.push(`لیکوییدیتی پایین: $${(liquidity / 1000).toFixed(0)}K (ریزش آسان)`);
  } else if (liquidity < 500000) {
    score += 8;
    details.push(`لیکوییدیتی متوسط: $${(liquidity / 1000).toFixed(0)}K`);
  }

  const createdAt = pair.pairCreatedAt ?? 0;
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
  if (ageHours < 24 && ageHours > 0) {
    score += 10;
    details.push(`توکن جدید: ${ageHours.toFixed(0)} ساعت پیش ایجاد شده`);
  } else if (ageHours < 72) {
    score += 5;
    details.push(`توکن نسبتاً جدید: ${(ageHours / 24).toFixed(1)} روز`);
  }

  return { score: Math.min(100, score), details };
}

function analyzeSentiment(pair: DexScreenerPair): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;

  const priceChange1h = pair.priceChange?.h1 ?? 0;
  const priceChange6h = pair.priceChange?.h6 ?? 0;

  if (priceChange1h < -10) {
    score += 15;
    details.push('سنتیمنت در حال تغییر: ریزش ۱ ساعته بیش از ۱۰٪');
  }

  const volumeH1 = pair.volume?.h1 ?? 0;
  const volumeH24 = pair.volume?.h24 ?? 0;
  const avgHourlyVol = volumeH24 / 24;
  if (volumeH1 < avgHourlyVol * 0.5 && avgHourlyVol > 0) {
    score += 12;
    details.push('کاهش حجم اجتماعی: volume ساعتی کمتر از میانگین');
  }

  if (priceChange6h < 0 && (pair.priceChange?.h24 ?? 0) > 100) {
    score += 10;
    details.push('فید سنتیمنت: رشد ۲۴ ساعته بالا ولی ۶ ساعته منفی');
  }

  const hasSocials = pair.info?.socials && pair.info.socials.length > 0;
  if (!hasSocials) {
    score += 8;
    details.push('بدون حساب رسمی شبکه اجتماعی (ریسک بالا)');
  }

  return { score: Math.min(100, score), details };
}

function analyzeDerivatives(pair: DexScreenerPair): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;

  const priceChange24h = pair.priceChange?.h24 ?? 0;
  if (priceChange24h > 300) {
    score += 15;
    details.push('پامپ شدید: احتمال funding rate مثبت بالا');
  }

  const txns1h = pair.txns?.h1;
  if (txns1h) {
    const totalTxns = txns1h.buys + txns1h.sells;
    if (totalTxns > 500) {
      score += 10;
      details.push(`تعداد تراکنش بالا: ${totalTxns} (فشار لانگ‌ها)`);
    }
  }

  if (priceChange24h > 200 && (pair.priceChange?.h1 ?? 0) < 0) {
    score += 12;
    details.push('لانگ‌ها در حال سوختن: پامپ ۲۴ ساعته اما ریزش ساعتی');
  }

  return { score: Math.min(100, score), details };
}

function analyzeHype(pair: DexScreenerPair): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;

  const priceChange24h = pair.priceChange?.h24 ?? 0;
  const priceChange1h = pair.priceChange?.h1 ?? 0;

  if (priceChange24h > 500 && priceChange1h < 5) {
    score += 25;
    details.push(`پامپ ${priceChange24h.toFixed(0)}٪ اما مومنتوم مرده`);
  } else if (priceChange24h > 200 && priceChange1h < 10) {
    score += 15;
    details.push(`رشد ${priceChange24h.toFixed(0)}٪ با کاهش شتاب`);
  }

  const fdv = pair.fdv ?? 0;
  if (fdv > 10000000 && fdv < 50000000) {
    score += 8;
    details.push(`مارکت‌کپ در رنج ریزش آسان: $${(fdv / 1000000).toFixed(1)}M`);
  } else if (fdv > 50000000) {
    score += 5;
    details.push(`مارکت‌کپ بالا: ریزش کندتر ولی محتمل`);
  }

  const volumeH24 = pair.volume?.h24 ?? 0;
  const volumeToMcap = volumeH24 / Math.max(1, fdv);
  if (volumeToMcap > 2) {
    score += 10;
    details.push(`حجم/مارکت‌کپ بالا: ${volumeToMcap.toFixed(1)}x (هایپ بیش از حد)`);
  }

  return { score: Math.min(100, score), details };
}

function generateTradeParams(
  price: number,
  signal: MemeShortSignal,
  pair: DexScreenerPair
): MemeShortSignal {
  const atr = price * 0.08;

  const entry = price;
  const stopLoss = price * (1 + 0.12);
  const target1 = price * (1 - 0.20);
  const target2 = price * (1 - 0.40);
  const riskReward = (entry - target1) / (stopLoss - entry);

  return {
    ...signal,
    entry: Math.round(entry * 100000000) / 100000000,
    target1: Math.round(target1 * 100000000) / 100000000,
    target2: Math.round(target2 * 100000000) / 100000000,
    stopLoss: Math.round(stopLoss * 100000000) / 100000000,
    riskReward: Math.round(riskReward * 10) / 10,
  };
}

function pairToMemeToken(pair: DexScreenerPair): MemeToken {
  const price = parseFloat(pair.priceUsd ?? '0');
  const exchanges = findExchangeAvailability(pair.baseToken?.symbol ?? '');

  const technical = analyzeTechnical(pair);
  const onchain = analyzeOnchain(pair);
  const sentiment = analyzeSentiment(pair);
  const derivatives = analyzeDerivatives(pair);
  const hype = analyzeHype(pair);

  let shortSignal = calculateMemeShortScore(
    technical.score,
    onchain.score,
    sentiment.score,
    derivatives.score,
    hype.score
  );

  shortSignal.breakdown.technical.details = technical.details;
  shortSignal.breakdown.onchain.details = onchain.details;
  shortSignal.breakdown.sentimentFade.details = sentiment.details;
  shortSignal.breakdown.derivatives.details = derivatives.details;
  shortSignal.breakdown.memeHype.details = hype.details;

  if (price > 0) {
    shortSignal = generateTradeParams(price, shortSignal, pair);
  }

  return {
    id: `${pair.chainId}-${pair.pairAddress}`,
    name: pair.baseToken?.name ?? 'Unknown',
    symbol: pair.baseToken?.symbol ?? '???',
    contractAddress: pair.baseToken?.address ?? '',
    chain: mapChainId(pair.chainId),
    currentPrice: price,
    priceChange1h: pair.priceChange?.h1 ?? 0,
    priceChange6h: pair.priceChange?.h6 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    pumpPercent: pair.priceChange?.h24 ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    volumeChange: 0,
    liquidity: pair.liquidity?.usd ?? 0,
    marketCap: pair.fdv ?? 0,
    holders: 0,
    createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : '',
    dexUrl: pair.url ?? '',
    pairAddress: pair.pairAddress ?? '',
    baseToken: pair.baseToken ?? { address: '', name: '', symbol: '' },
    quoteToken: pair.quoteToken ?? { address: '', name: '', symbol: '' },
    availableExchanges: exchanges,
    shortSignal,
    scanTimestamp: Date.now(),
  };
}

export async function scanMemeTokens(
  filter: MemeScannerFilter = DEFAULT_MEME_FILTER
): Promise<MemeToken[]> {
  console.log('[MemeAPI] Starting meme scan with filter:', filter);

  try {
    const [boostedTokens, searchPairs] = await Promise.all([
      fetchDexScreenerBoostedTokens(),
      fetchDexScreenerTopGainers(),
    ]);

    const tokenAddresses = boostedTokens
      .slice(0, 15)
      .map((t) => t.tokenAddress)
      .filter(Boolean);

    let boostedPairs: DexScreenerPair[] = [];
    if (tokenAddresses.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < tokenAddresses.length; i += batchSize) {
        const batch = tokenAddresses.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((addr) => fetchTokenByAddress(addr)));
        for (const result of results) {
          boostedPairs.push(...result);
        }
      }
    }

    const allPairs = [...boostedPairs, ...searchPairs];
    console.log(`[MemeAPI] Total pairs collected: ${allPairs.length}`);

    const seen = new Set<string>();
    const uniquePairs = allPairs.filter((p) => {
      const key = `${p.chainId}-${p.pairAddress}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let tokens = uniquePairs
      .filter((pair) => {
        const price24h = pair.priceChange?.h24 ?? 0;
        const volume = pair.volume?.h24 ?? 0;
        const liquidity = pair.liquidity?.usd ?? 0;
        const fdv = pair.fdv ?? 0;
        const chain = mapChainId(pair.chainId);

        if (price24h < filter.minPump) return false;
        if (volume < filter.minVolume) return false;
        if (liquidity < filter.minLiquidity) return false;
        if (fdv > filter.maxMarketCap || fdv < filter.minMarketCap) return false;
        if (!filter.chains.includes(chain)) return false;

        return true;
      })
      .map(pairToMemeToken);

    tokens = tokens.filter(
      (t) => t.shortSignal && t.shortSignal.confidence >= filter.minConfidence
    );

    tokens.sort((a, b) => (b.shortSignal?.confidence ?? 0) - (a.shortSignal?.confidence ?? 0));

    console.log(`[MemeAPI] Final tokens after filtering: ${tokens.length}`);
    return tokens.slice(0, 50);
  } catch (error) {
    console.log('[MemeAPI] Scan error:', error);
    return [];
  }
}

export async function searchMemeToken(query: string): Promise<MemeToken[]> {
  try {
    console.log(`[MemeAPI] Searching for: ${query}`);
    const response = await fetch(`${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const data: DexScreenerResponse = await response.json();
    const pairs = data.pairs ?? [];
    return pairs.slice(0, 20).map(pairToMemeToken);
  } catch (error) {
    console.log('[MemeAPI] Search error:', error);
    return [];
  }
}
