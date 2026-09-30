import { ExchangeId } from './crypto';

export interface MemeToken {
  id: string;
  name: string;
  symbol: string;
  contractAddress: string;
  chain: 'solana' | 'ethereum' | 'bsc' | 'base' | 'arbitrum';
  currentPrice: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  pumpPercent: number;
  volume24h: number;
  volumeChange: number;
  liquidity: number;
  marketCap: number;
  holders: number;
  createdAt: string;
  dexUrl: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  availableExchanges: MemeExchangeAvailability[];
  shortSignal: MemeShortSignal | null;
  scanTimestamp: number;
}

export interface MemeExchangeAvailability {
  exchangeId: ExchangeId;
  exchangeName: string;
  hasFutures: boolean;
  symbol: string;
}

export interface MemeShortSignal {
  confidence: number;
  level: 'strong' | 'medium' | 'weak' | 'avoid';
  levelText: string;
  recommendedLeverage: number;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  riskReward: number;
  recommendation: string;
  breakdown: MemeShortBreakdown;
}

export interface MemeShortBreakdown {
  technical: MemeScoreDetail;
  onchain: MemeScoreDetail;
  sentimentFade: MemeScoreDetail;
  derivatives: MemeScoreDetail;
  memeHype: MemeScoreDetail;
}

export interface MemeScoreDetail {
  score: number;
  weight: number;
  details: string[];
}

export interface MemeShortTrade {
  id: string;
  token: MemeToken;
  exchangeId: ExchangeId;
  apiKey: string;
  apiSecret: string;
  side: 'sell';
  leverage: number;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  target1: number;
  target2: number;
  stopLoss: number;
  status: 'pending' | 'open' | 'closed' | 'cancelled';
  pnl: number;
  pnlPercent: number;
  openedAt: number;
  closedAt: number | null;
}

export interface MemeExchangeConfig {
  id: string;
  exchangeId: ExchangeId;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface MemeScannerFilter {
  minPump: number;
  maxMarketCap: number;
  minMarketCap: number;
  minVolume: number;
  minLiquidity: number;
  chains: string[];
  minConfidence: number;
}

export const DEFAULT_MEME_FILTER: MemeScannerFilter = {
  minPump: 100,
  maxMarketCap: 50000000,
  minMarketCap: 100000,
  minVolume: 50000,
  minLiquidity: 10000,
  chains: ['solana', 'ethereum', 'bsc', 'base'],
  minConfidence: 65,
};
