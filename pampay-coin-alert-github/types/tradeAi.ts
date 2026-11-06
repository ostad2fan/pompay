export type TradingStrategy = 'conservative' | 'balanced' | 'aggressive' | 'scalper';

export interface ConfluenceBreakdown {
  technical: number;
  onChain: number;
  sentiment: number;
  derivatives: number;
  multiTimeframe: number;
  details: {
    technical: string[];
    onChain: string[];
    sentiment: string[];
    derivatives: string[];
    multiTimeframe: string[];
  };
}

export interface AITradeSignal {
  id: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  strategy: TradingStrategy;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  indicators: IndicatorResult[];
  timestamp: number;
  timeframe: string;
  riskReward: number;
  confluence?: ConfluenceBreakdown;
}

export interface IndicatorResult {
  name: string;
  value: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  description: string;
}

export interface DemoPortfolio {
  balance: number;
  initialBalance: number;
  positions: DemoPosition[];
  closedTrades: ClosedTrade[];
  totalPnl: number;
  winRate: number;
  totalTrades: number;
}

export interface DemoPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
  openedAt: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
  openedAt: number;
  closedAt: number;
  reason: 'tp' | 'sl' | 'trailing' | 'manual' | 'ai';
}

export interface AIAnalysisRequest {
  symbol: string;
  strategy: TradingStrategy;
  indicators: IndicatorResult[];
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  fundingRate: number;
}

export interface StrategyConfig {
  name: string;
  nameEn: string;
  description: string;
  riskLevel: number;
  maxLeverage: number;
  stopLossPercent: number;
  takeProfitMultiplier: number;
  trailingStopPercent: number;
  dcaEnabled: boolean;
  dcaLevels: number;
}

export const STRATEGY_CONFIGS: Record<TradingStrategy, StrategyConfig> = {
  conservative: {
    name: 'محافظه‌کارانه',
    nameEn: 'Conservative',
    description: 'ریسک کم، سود کمتر اما مطمئن‌تر',
    riskLevel: 1,
    maxLeverage: 3,
    stopLossPercent: 2,
    takeProfitMultiplier: 1.5,
    trailingStopPercent: 1.5,
    dcaEnabled: true,
    dcaLevels: 3,
  },
  balanced: {
    name: 'متعادل',
    nameEn: 'Balanced',
    description: 'تعادل بین ریسک و سود',
    riskLevel: 2,
    maxLeverage: 5,
    stopLossPercent: 3,
    takeProfitMultiplier: 2,
    trailingStopPercent: 2,
    dcaEnabled: true,
    dcaLevels: 2,
  },
  aggressive: {
    name: 'تهاجمی',
    nameEn: 'Aggressive',
    description: 'ریسک بالا، سود بالقوه بیشتر',
    riskLevel: 3,
    maxLeverage: 10,
    stopLossPercent: 5,
    takeProfitMultiplier: 3,
    trailingStopPercent: 3,
    dcaEnabled: false,
    dcaLevels: 0,
  },
  scalper: {
    name: 'اسکالپر',
    nameEn: 'Scalper',
    description: 'معاملات سریع با سود کوچک',
    riskLevel: 2,
    maxLeverage: 7,
    stopLossPercent: 1,
    takeProfitMultiplier: 1.2,
    trailingStopPercent: 0.5,
    dcaEnabled: false,
    dcaLevels: 0,
  },
};
