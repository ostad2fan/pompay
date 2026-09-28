import CryptoJS from 'crypto-js';
import { Platform } from 'react-native';

const FUTURES_BASE = 'https://fapi.binance.com';

export interface BinanceFuturesOrder {
  orderId: number;
  symbol: string;
  status: string;
  clientOrderId: string;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  cumQuote: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  positionSide: string;
  updateTime: number;
}

export interface BinanceFuturesPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  maxNotionalValue: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  notional: string;
  updateTime: number;
}

export interface BinanceAccountInfo {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  positions: BinanceFuturesPosition[];
}

export interface RealPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  markPrice: number;
  size: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  marginType: string;
  notional: number;
  stopLossOrderId?: number;
  takeProfitOrderId?: number;
  trailingStopOrderId?: number;
  customStopLoss?: number;
  customTakeProfit?: number;
  customTrailingStop?: number;
}

export interface OpenOrder {
  orderId: number;
  symbol: string;
  type: string;
  side: string;
  price: string;
  stopPrice: string;
  origQty: string;
  status: string;
  time: number;
}

function signQuery(queryString: string, apiSecret: string): string {
  const signature = CryptoJS.HmacSHA256(queryString, apiSecret).toString(CryptoJS.enc.Hex);
  return signature;
}

function buildSignedUrl(endpoint: string, params: Record<string, string | number>, apiKey: string, apiSecret: string): { url: string; headers: Record<string, string> } {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp, recvWindow: 10000 };
  const queryString = Object.entries(allParams)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const signature = signQuery(queryString, apiSecret);
  const url = `${FUTURES_BASE}${endpoint}?${queryString}&signature=${signature}`;
  const headers: Record<string, string> = {
    'X-MBX-APIKEY': apiKey,
  };
  return { url, headers };
}

async function signedRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number>,
  apiKey: string,
  apiSecret: string,
): Promise<unknown> {
  if (!apiKey || !apiSecret) {
    throw new Error('API Key و Secret وارد نشده است. به تنظیمات بروید.');
  }

  const { url, headers } = buildSignedUrl(endpoint, params, apiKey, apiSecret);

  console.log(`[BinanceFutures] ${method} ${endpoint}`, params);

  const response = await fetch(url, {
    method,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = (data as { msg?: string })?.msg || `خطا: ${response.status}`;
    console.log(`[BinanceFutures] Error:`, data);
    throw new Error(errMsg);
  }

  return data;
}

export async function getAccountInfo(apiKey: string, apiSecret: string): Promise<BinanceAccountInfo> {
  console.log('[BinanceFutures] Getting account info...');
  const data = await signedRequest('GET', '/fapi/v2/account', {}, apiKey, apiSecret);
  return data as BinanceAccountInfo;
}

export async function getPositions(apiKey: string, apiSecret: string): Promise<BinanceFuturesPosition[]> {
  console.log('[BinanceFutures] Getting positions...');
  const data = await signedRequest('GET', '/fapi/v2/positionRisk', {}, apiKey, apiSecret);
  const positions = data as BinanceFuturesPosition[];
  return positions.filter(p => parseFloat(p.positionAmt) !== 0);
}

export async function getOpenOrders(apiKey: string, apiSecret: string, symbol?: string): Promise<OpenOrder[]> {
  console.log('[BinanceFutures] Getting open orders...');
  const params: Record<string, string | number> = {};
  if (symbol) params.symbol = symbol;
  const data = await signedRequest('GET', '/fapi/v1/openOrders', params, apiKey, apiSecret);
  return data as OpenOrder[];
}

export async function setLeverage(apiKey: string, apiSecret: string, symbol: string, leverage: number): Promise<void> {
  console.log(`[BinanceFutures] Setting leverage for ${symbol} to ${leverage}x`);
  await signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage }, apiKey, apiSecret);
}

export async function setMarginType(apiKey: string, apiSecret: string, symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
  console.log(`[BinanceFutures] Setting margin type for ${symbol} to ${marginType}`);
  try {
    await signedRequest('POST', '/fapi/v1/marginType', { symbol, marginType }, apiKey, apiSecret);
  } catch (e: unknown) {
    const msg = (e as Error)?.message || '';
    if (msg.includes('No need to change margin type')) {
      console.log('[BinanceFutures] Margin type already set');
      return;
    }
    throw e;
  }
}

export async function placeMarketOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
): Promise<BinanceFuturesOrder> {
  console.log(`[BinanceFutures] Placing market order: ${side} ${quantity} ${symbol}`);
  const data = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity,
  }, apiKey, apiSecret);
  return data as BinanceFuturesOrder;
}

export async function placeStopLossOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number,
): Promise<BinanceFuturesOrder> {
  console.log(`[BinanceFutures] Placing stop loss: ${side} ${quantity} ${symbol} @ ${stopPrice}`);
  const data = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'STOP_MARKET',
    quantity,
    stopPrice,
    closePosition: 'true',
  }, apiKey, apiSecret);
  return data as BinanceFuturesOrder;
}

export async function placeTakeProfitOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number,
): Promise<BinanceFuturesOrder> {
  console.log(`[BinanceFutures] Placing take profit: ${side} ${quantity} ${symbol} @ ${stopPrice}`);
  const data = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    quantity,
    stopPrice,
    closePosition: 'true',
  }, apiKey, apiSecret);
  return data as BinanceFuturesOrder;
}

export async function placeTrailingStopOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  callbackRate: number,
  activationPrice?: number,
): Promise<BinanceFuturesOrder> {
  console.log(`[BinanceFutures] Placing trailing stop: ${side} ${quantity} ${symbol} callback ${callbackRate}%`);
  const params: Record<string, string | number> = {
    symbol,
    side,
    type: 'TRAILING_STOP_MARKET',
    quantity,
    callbackRate,
  };
  if (activationPrice) {
    params.activationPrice = activationPrice;
  }
  const data = await signedRequest('POST', '/fapi/v1/order', params, apiKey, apiSecret);
  return data as BinanceFuturesOrder;
}

export async function cancelOrder(apiKey: string, apiSecret: string, symbol: string, orderId: number): Promise<void> {
  console.log(`[BinanceFutures] Cancelling order ${orderId} for ${symbol}`);
  await signedRequest('DELETE', '/fapi/v1/order', { symbol, orderId }, apiKey, apiSecret);
}

export async function cancelAllOrders(apiKey: string, apiSecret: string, symbol: string): Promise<void> {
  console.log(`[BinanceFutures] Cancelling all orders for ${symbol}`);
  await signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol }, apiKey, apiSecret);
}

export async function closePosition(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  positionAmt: number,
): Promise<BinanceFuturesOrder> {
  const side = positionAmt > 0 ? 'SELL' : 'BUY';
  const quantity = Math.abs(positionAmt);
  console.log(`[BinanceFutures] Closing position: ${side} ${quantity} ${symbol}`);

  await cancelAllOrders(apiKey, apiSecret, symbol);

  const data = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity,
    reduceOnly: 'true',
  }, apiKey, apiSecret);
  return data as BinanceFuturesOrder;
}

export async function getSymbolInfo(symbol: string): Promise<{ pricePrecision: number; quantityPrecision: number; minQty: number; minNotional: number }> {
  console.log(`[BinanceFutures] Getting symbol info for ${symbol}`);
  const response = await fetch(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
  const data = await response.json();
  const symbolInfo = (data.symbols as Array<{
    symbol: string;
    pricePrecision: number;
    quantityPrecision: number;
    filters: Array<{ filterType: string; minQty?: string; notional?: string }>;
  }>).find((s) => s.symbol === symbol);

  if (!symbolInfo) throw new Error(`نماد ${symbol} یافت نشد`);

  const lotFilter = symbolInfo.filters.find((f) => f.filterType === 'LOT_SIZE');
  const minNotionalFilter = symbolInfo.filters.find((f) => f.filterType === 'MIN_NOTIONAL');

  return {
    pricePrecision: symbolInfo.pricePrecision,
    quantityPrecision: symbolInfo.quantityPrecision,
    minQty: parseFloat(lotFilter?.minQty || '0.001'),
    minNotional: parseFloat(minNotionalFilter?.notional || '5'),
  };
}

export function calculateQuantity(
  usdtAmount: number,
  price: number,
  leverage: number,
  quantityPrecision: number,
): number {
  const notional = usdtAmount * leverage;
  const qty = notional / price;
  const factor = Math.pow(10, quantityPrecision);
  return Math.floor(qty * factor) / factor;
}

export async function openRealPosition(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'long' | 'short',
  usdtAmount: number,
  leverage: number,
  stopLoss: number,
  takeProfit: number,
  trailingCallbackRate?: number,
): Promise<{ order: BinanceFuturesOrder; slOrder?: BinanceFuturesOrder; tpOrder?: BinanceFuturesOrder; tsOrder?: BinanceFuturesOrder }> {
  console.log(`[BinanceFutures] Opening real position: ${side} ${symbol} $${usdtAmount} ${leverage}x`);

  const symbolInfo = await getSymbolInfo(symbol);

  await setLeverage(apiKey, apiSecret, symbol, leverage);

  try {
    await setMarginType(apiKey, apiSecret, symbol, 'ISOLATED');
  } catch {}

  const currentPriceRes = await fetch(`${FUTURES_BASE}/fapi/v1/ticker/price?symbol=${symbol}`);
  const priceData = await currentPriceRes.json() as { price: string };
  const currentPrice = parseFloat(priceData.price);

  const quantity = calculateQuantity(usdtAmount, currentPrice, leverage, symbolInfo.quantityPrecision);

  if (quantity <= 0 || quantity < symbolInfo.minQty) {
    throw new Error(`حجم معامله کم است. حداقل: ${symbolInfo.minQty}`);
  }

  const orderSide = side === 'long' ? 'BUY' : 'SELL';
  const closeSide = side === 'long' ? 'SELL' : 'BUY';

  const order = await placeMarketOrder(apiKey, apiSecret, symbol, orderSide as 'BUY' | 'SELL', quantity);

  let slOrder: BinanceFuturesOrder | undefined;
  let tpOrder: BinanceFuturesOrder | undefined;
  let tsOrder: BinanceFuturesOrder | undefined;

  try {
    if (stopLoss > 0) {
      slOrder = await placeStopLossOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, stopLoss);
    }
  } catch (e) {
    console.log('[BinanceFutures] Error placing SL:', e);
  }

  try {
    if (takeProfit > 0) {
      tpOrder = await placeTakeProfitOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, takeProfit);
    }
  } catch (e) {
    console.log('[BinanceFutures] Error placing TP:', e);
  }

  try {
    if (trailingCallbackRate && trailingCallbackRate > 0) {
      tsOrder = await placeTrailingStopOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, trailingCallbackRate);
    }
  } catch (e) {
    console.log('[BinanceFutures] Error placing trailing stop:', e);
  }

  return { order, slOrder, tpOrder, tsOrder };
}

export function parsePositions(positions: BinanceFuturesPosition[]): RealPosition[] {
  return positions
    .filter(p => parseFloat(p.positionAmt) !== 0)
    .map(p => {
      const amt = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const mark = parseFloat(p.markPrice);
      const pnl = parseFloat(p.unRealizedProfit);
      const lev = parseInt(p.leverage, 10);
      const notional = Math.abs(amt) * mark;
      const margin = notional / lev;
      const pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0;

      return {
        id: `${p.symbol}-${p.positionSide}`,
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        entryPrice: entry,
        markPrice: mark,
        size: Math.abs(amt),
        leverage: lev,
        pnl,
        pnlPercent,
        liquidationPrice: parseFloat(p.liquidationPrice),
        marginType: p.marginType,
        notional,
      } as RealPosition;
    });
}

export async function updateStopLoss(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'long' | 'short',
  quantity: number,
  newStopLoss: number,
): Promise<BinanceFuturesOrder> {
  const closeSide = side === 'long' ? 'SELL' : 'BUY';

  const orders = await getOpenOrders(apiKey, apiSecret, symbol);
  const slOrders = orders.filter(o => o.type === 'STOP_MARKET');
  for (const o of slOrders) {
    await cancelOrder(apiKey, apiSecret, symbol, o.orderId);
  }

  return placeStopLossOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, newStopLoss);
}

export async function updateTakeProfit(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'long' | 'short',
  quantity: number,
  newTakeProfit: number,
): Promise<BinanceFuturesOrder> {
  const closeSide = side === 'long' ? 'SELL' : 'BUY';

  const orders = await getOpenOrders(apiKey, apiSecret, symbol);
  const tpOrders = orders.filter(o => o.type === 'TAKE_PROFIT_MARKET');
  for (const o of tpOrders) {
    await cancelOrder(apiKey, apiSecret, symbol, o.orderId);
  }

  return placeTakeProfitOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, newTakeProfit);
}

export async function setTrailingStop(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'long' | 'short',
  quantity: number,
  callbackRate: number,
  activationPrice?: number,
): Promise<BinanceFuturesOrder> {
  const closeSide = side === 'long' ? 'SELL' : 'BUY';

  const orders = await getOpenOrders(apiKey, apiSecret, symbol);
  const tsOrders = orders.filter(o => o.type === 'TRAILING_STOP_MARKET');
  for (const o of tsOrders) {
    await cancelOrder(apiKey, apiSecret, symbol, o.orderId);
  }

  return placeTrailingStopOrder(apiKey, apiSecret, symbol, closeSide as 'BUY' | 'SELL', quantity, callbackRate, activationPrice);
}
