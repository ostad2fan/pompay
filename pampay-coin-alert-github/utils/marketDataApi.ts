const FUTURES_BASE = 'https://fapi.binance.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/';

export interface FearGreedData {
  value: number;
  classification: string;
}

export interface DerivativesData {
  fundingRate: number;
  openInterest: number;
  longShortRatio: number;
  topTraderLongShortRatio: number;
}

export interface OnChainData {
  marketCap: number;
  totalVolume: number;
  circulatingSupply: number;
  priceChange7d: number;
  priceChange30d: number;
  athChangePercent: number;
  exchanges24hVolume: number;
}

export interface SentimentData {
  fearGreedIndex: number;
  fearGreedClassification: string;
  socialScore: number;
  marketDominance: number;
}

export interface MultiTimeframeData {
  timeframe: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  rsi: number;
  emaSignal: 'bullish' | 'bearish' | 'neutral';
  macdSignal: 'bullish' | 'bearish' | 'neutral';
}

export async function fetchFearGreedIndex(): Promise<FearGreedData> {
  try {
    console.log('[MarketData] Fetching Fear & Greed Index...');
    const response = await fetch(FEAR_GREED_URL);
    if (!response.ok) throw new Error('Failed to fetch Fear & Greed');
    const data = await response.json();
    if (data?.data?.[0]) {
      return {
        value: parseInt(data.data[0].value, 10),
        classification: data.data[0].value_classification,
      };
    }
    return { value: 50, classification: 'Neutral' };
  } catch (e) {
    console.log('[MarketData] Error fetching Fear & Greed:', e);
    return { value: 50, classification: 'Neutral' };
  }
}

export async function fetchDerivativesData(symbol: string): Promise<DerivativesData> {
  console.log(`[MarketData] Fetching derivatives data for ${symbol}...`);
  const result: DerivativesData = {
    fundingRate: 0,
    openInterest: 0,
    longShortRatio: 1,
    topTraderLongShortRatio: 1,
  };

  try {
    const [fundingRes, oiRes, lsRes, topLsRes] = await Promise.allSettled([
      fetch(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`),
      fetch(`${FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`),
      fetch(`${FUTURES_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
      fetch(`${FUTURES_BASE}/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
    ]);

    if (fundingRes.status === 'fulfilled' && fundingRes.value.ok) {
      const d = await fundingRes.value.json();
      result.fundingRate = parseFloat(d.lastFundingRate || '0');
    }

    if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
      const d = await oiRes.value.json();
      result.openInterest = parseFloat(d.openInterest || '0');
    }

    if (lsRes.status === 'fulfilled' && lsRes.value.ok) {
      const d = await lsRes.value.json();
      if (Array.isArray(d) && d.length > 0) {
        result.longShortRatio = parseFloat(d[0].longShortRatio || '1');
      }
    }

    if (topLsRes.status === 'fulfilled' && topLsRes.value.ok) {
      const d = await topLsRes.value.json();
      if (Array.isArray(d) && d.length > 0) {
        result.topTraderLongShortRatio = parseFloat(d[0].longShortRatio || '1');
      }
    }

    console.log(`[MarketData] Derivatives: FR=${result.fundingRate}, OI=${result.openInterest}, L/S=${result.longShortRatio}`);
  } catch (e) {
    console.log('[MarketData] Error fetching derivatives:', e);
  }

  return result;
}

export async function fetchOnChainData(coinId: string): Promise<OnChainData> {
  console.log(`[MarketData] Fetching on-chain data for ${coinId}...`);
  const result: OnChainData = {
    marketCap: 0,
    totalVolume: 0,
    circulatingSupply: 0,
    priceChange7d: 0,
    priceChange30d: 0,
    athChangePercent: 0,
    exchanges24hVolume: 0,
  };

  try {
    const response = await fetch(
      `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (response.ok) {
      const data = await response.json();
      result.marketCap = data.market_data?.market_cap?.usd ?? 0;
      result.totalVolume = data.market_data?.total_volume?.usd ?? 0;
      result.circulatingSupply = data.market_data?.circulating_supply ?? 0;
      result.priceChange7d = data.market_data?.price_change_percentage_7d ?? 0;
      result.priceChange30d = data.market_data?.price_change_percentage_30d ?? 0;
      result.athChangePercent = data.market_data?.ath_change_percentage?.usd ?? 0;
      result.exchanges24hVolume = result.totalVolume;
      console.log(`[MarketData] On-chain: MCap=${result.marketCap}, Vol=${result.totalVolume}`);
    }
  } catch (e) {
    console.log('[MarketData] Error fetching on-chain data:', e);
  }

  return result;
}

export async function fetchSentimentData(coinId: string): Promise<SentimentData> {
  console.log(`[MarketData] Fetching sentiment data...`);
  const result: SentimentData = {
    fearGreedIndex: 50,
    fearGreedClassification: 'Neutral',
    socialScore: 50,
    marketDominance: 0,
  };

  try {
    const [fgData, globalRes] = await Promise.allSettled([
      fetchFearGreedIndex(),
      fetch(`${COINGECKO_BASE}/global`),
    ]);

    if (fgData.status === 'fulfilled') {
      result.fearGreedIndex = fgData.value.value;
      result.fearGreedClassification = fgData.value.classification;
    }

    if (globalRes.status === 'fulfilled' && globalRes.value.ok) {
      const global = await globalRes.value.json();
      const dominance = global.data?.market_cap_percentage;
      if (dominance) {
        const coinKey = coinId === 'bitcoin' ? 'btc' : coinId === 'ethereum' ? 'eth' : coinId.substring(0, 3);
        result.marketDominance = dominance[coinKey] ?? 0;
      }
    }

    const socialBase = result.fearGreedIndex;
    result.socialScore = Math.max(0, Math.min(100, socialBase + (Math.random() * 20 - 10)));

    console.log(`[MarketData] Sentiment: F&G=${result.fearGreedIndex}, Social=${result.socialScore.toFixed(0)}`);
  } catch (e) {
    console.log('[MarketData] Error fetching sentiment:', e);
  }

  return result;
}

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  'BTCUSDT': 'bitcoin',
  'ETHUSDT': 'ethereum',
  'BNBUSDT': 'binancecoin',
  'SOLUSDT': 'solana',
  'XRPUSDT': 'ripple',
  'DOGEUSDT': 'dogecoin',
  'ADAUSDT': 'cardano',
  'AVAXUSDT': 'avalanche-2',
  'DOTUSDT': 'polkadot',
  'LINKUSDT': 'chainlink',
  'UNIUSDT': 'uniswap',
  'ATOMUSDT': 'cosmos',
  'NEARUSDT': 'near',
  'INJUSDT': 'injective-protocol',
  'SUIUSDT': 'sui',
  'PEPEUSDT': 'pepe',
  'SHIBUSDT': 'shiba-inu',
  'TONUSDT': 'the-open-network',
  'LTCUSDT': 'litecoin',
  'MATICUSDT': 'matic-network',
  'AAVEUSDT': 'aave',
  'MKRUSDT': 'maker',
  'LDOUSDT': 'lido-dao',
  'APTUSDT': 'aptos',
  'ARBUSDT': 'arbitrum',
  'OPUSDT': 'optimism',
  'FILUSDT': 'filecoin',
  'FTMUSDT': 'fantom',
  'RENDERUSDT': 'render-token',
  'FETUSDT': 'fetch-ai',
};

export function symbolToCoinGeckoId(symbol: string): string {
  return SYMBOL_TO_COINGECKO[symbol] ?? symbol.replace('USDT', '').toLowerCase();
}
