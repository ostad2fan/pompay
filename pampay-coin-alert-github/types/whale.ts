export interface WhaleWallet {
  id: string;
  address: string;
  label: string;
  addedAt: number;
  pnl30d: number;
  winRate: number;
}

export interface WhaleToken {
  symbol: string;
  name: string;
  contractAddress: string;
  amount: number;
  valueUsd: number;
  priceChangePercent24h: number;
  isMeme: boolean;
  exchanges: ExchangeListing[];
}

export interface ExchangeListing {
  name: string;
  type: 'cex' | 'dex';
}

export interface WhalePosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  leverage: number;
  openedAt: number;
}

export interface WhaleTransaction {
  id: string;
  type: 'buy' | 'sell';
  symbol: string;
  name: string;
  contractAddress: string;
  amount: number;
  valueUsd: number;
  timestamp: number;
  isMeme: boolean;
}

export interface TopWhale {
  address: string;
  label: string;
  pnl30d: number;
  winRate: number;
  topTrades: string[];
  isTracked: boolean;
}
