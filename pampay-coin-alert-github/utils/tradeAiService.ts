import { generateObject } from './aiClient';
import { z } from 'zod';
import {
  AITradeSignal,
  IndicatorResult,
  TradingStrategy,
  STRATEGY_CONFIGS,
  DemoPortfolio,
  DemoPosition,
  ClosedTrade,
  ConfluenceBreakdown,
} from '@/types/tradeAi';
import { fetchKlines, fetchFundingRate } from '@/utils/binanceApi';
import {
  fetchDerivativesData,
  fetchSentimentData,
  fetchOnChainData,
  symbolToCoinGeckoId,
} from '@/utils/marketDataApi';

function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  ema[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine[i] = ema12[i] - ema26[i];
  }
  const signalLine = calculateEMA(macdLine, 9);
  const lastIdx = closes.length - 1;
  const macd = macdLine[lastIdx];
  const signal = signalLine[lastIdx];
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(closes: number[], period: number = 20, stdDev: number = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, percentB: 0.5 };
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const currentPrice = closes[closes.length - 1];
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, percentB };
}

function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  const recentTrs = trs.slice(-period);
  return recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
}

function calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period * 2) return 0;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  const smoothTR = calculateEMA(tr, period);
  const smoothPlusDM = calculateEMA(plusDM, period);
  const smoothMinusDM = calculateEMA(minusDM, period);

  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dx.push(0); continue; }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }

  const adx = calculateEMA(dx, period);
  return adx[adx.length - 1] ?? 0;
}

function calculateStochasticRSI(closes: number[], rsiPeriod: number = 14, stochPeriod: number = 14): { k: number; d: number } {
  if (closes.length < rsiPeriod + stochPeriod) return { k: 50, d: 50 };

  const rsiValues: number[] = [];
  for (let i = rsiPeriod + 1; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    rsiValues.push(calculateRSI(slice, rsiPeriod));
  }

  if (rsiValues.length < stochPeriod) return { k: 50, d: 50 };

  const recentRSIs = rsiValues.slice(-stochPeriod);
  const minRSI = Math.min(...recentRSIs);
  const maxRSI = Math.max(...recentRSIs);
  const currentRSI = recentRSIs[recentRSIs.length - 1];

  const k = maxRSI !== minRSI ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 : 50;

  const kValues: number[] = [];
  for (let i = stochPeriod; i <= rsiValues.length; i++) {
    const window = rsiValues.slice(i - stochPeriod, i);
    const wMin = Math.min(...window);
    const wMax = Math.max(...window);
    const last = window[window.length - 1];
    kValues.push(wMax !== wMin ? ((last - wMin) / (wMax - wMin)) * 100 : 50);
  }
  const d = kValues.length >= 3 ? kValues.slice(-3).reduce((a, b) => a + b, 0) / 3 : k;

  return { k, d };
}

function calculateOBV(closes: number[], volumes: number[]): { value: number; trend: 'bullish' | 'bearish' | 'neutral' } {
  if (closes.length < 2) return { value: 0, trend: 'neutral' };

  let obv = 0;
  const obvValues: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvValues.push(obv);
  }

  const recentObv = obvValues.slice(-10);
  const firstHalf = recentObv.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalf = recentObv.slice(-5).reduce((a, b) => a + b, 0) / 5;

  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (secondHalf > firstHalf * 1.05) trend = 'bullish';
  else if (secondHalf < firstHalf * 0.95) trend = 'bearish';

  return { value: obv, trend };
}

function calculateIchimoku(highs: number[], lows: number[], closes: number[]): {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  aboveCloud: boolean;
  signal: 'bullish' | 'bearish' | 'neutral';
} {
  const defaultResult = { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0, aboveCloud: false, signal: 'neutral' as const };
  if (highs.length < 52) return defaultResult;

  const calcMidpoint = (h: number[], l: number[], period: number) => {
    const hSlice = h.slice(-period);
    const lSlice = l.slice(-period);
    return (Math.max(...hSlice) + Math.min(...lSlice)) / 2;
  };

  const tenkan = calcMidpoint(highs, lows, 9);
  const kijun = calcMidpoint(highs, lows, 26);
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = calcMidpoint(highs, lows, 52);
  const currentPrice = closes[closes.length - 1];
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (currentPrice > cloudTop && tenkan > kijun) signal = 'bullish';
  else if (currentPrice < cloudBottom && tenkan < kijun) signal = 'bearish';
  else if (currentPrice > cloudTop) signal = 'bullish';
  else if (currentPrice < cloudBottom) signal = 'bearish';

  return { tenkan, kijun, senkouA, senkouB, aboveCloud: currentPrice > cloudTop, signal };
}

function calculateFibonacciLevels(highs: number[], lows: number[]): {
  levels: Record<string, number>;
  nearestSupport: number;
  nearestResistance: number;
} {
  const recent = 50;
  const h = highs.slice(-recent);
  const l = lows.slice(-recent);
  const high = Math.max(...h);
  const low = Math.min(...l);
  const diff = high - low;

  const levels: Record<string, number> = {
    '0.0': high,
    '0.236': high - diff * 0.236,
    '0.382': high - diff * 0.382,
    '0.5': high - diff * 0.5,
    '0.618': high - diff * 0.618,
    '0.786': high - diff * 0.786,
    '1.0': low,
  };

  const currentPrice = (h[h.length - 1] + l[l.length - 1]) / 2;
  const allLevels = Object.values(levels).sort((a, b) => b - a);
  let nearestSupport = low;
  let nearestResistance = high;

  for (const lvl of allLevels) {
    if (lvl < currentPrice && lvl > nearestSupport) nearestSupport = lvl;
    if (lvl > currentPrice && lvl < nearestResistance) nearestResistance = lvl;
  }

  return { levels, nearestSupport, nearestResistance };
}

async function analyzeTimeframe(
  symbol: string,
  timeframe: string,
): Promise<{ trend: 'bullish' | 'bearish' | 'neutral'; rsi: number; emaSignal: string; macdSignal: string; details: string[] }> {
  const details: string[] = [];
  try {
    const klines = await fetchKlines(symbol, timeframe, 100);
    if (klines.length < 30) return { trend: 'neutral', rsi: 50, emaSignal: 'neutral', macdSignal: 'neutral', details: ['داده کافی نیست'] };

    const closes = klines.map((k) => parseFloat(String(k[4])));
    const rsi = calculateRSI(closes);
    const { histogram } = calculateMACD(closes);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const lastIdx = closes.length - 1;

    let bullish = 0;
    let bearish = 0;

    if (ema9[lastIdx] > ema21[lastIdx]) { bullish++; details.push(`EMA9 > EMA21 (${timeframe})`); }
    else { bearish++; details.push(`EMA9 < EMA21 (${timeframe})`); }

    if (histogram > 0) { bullish++; details.push(`MACD صعودی (${timeframe})`); }
    else { bearish++; details.push(`MACD نزولی (${timeframe})`); }

    if (rsi < 40) { bullish++; details.push(`RSI=${rsi.toFixed(0)} اشباع فروش (${timeframe})`); }
    else if (rsi > 60) { bearish++; details.push(`RSI=${rsi.toFixed(0)} اشباع خرید (${timeframe})`); }

    const trend = bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral';
    const emaSignal = ema9[lastIdx] > ema21[lastIdx] ? 'bullish' : 'bearish';
    const macdSignal = histogram > 0 ? 'bullish' : 'bearish';

    return { trend, rsi, emaSignal, macdSignal, details };
  } catch (e) {
    console.log(`[TradeAI] Error analyzing ${timeframe}:`, e);
    return { trend: 'neutral', rsi: 50, emaSignal: 'neutral', macdSignal: 'neutral', details: ['خطا در تحلیل'] };
  }
}

export async function analyzeIndicators(symbol: string, timeframe: string = '1h'): Promise<IndicatorResult[]> {
  console.log(`[TradeAI] Analyzing indicators for ${symbol} on ${timeframe}`);
  const indicators: IndicatorResult[] = [];

  try {
    const klines = await fetchKlines(symbol, timeframe, 100);
    if (klines.length < 30) {
      console.log('[TradeAI] Not enough kline data');
      return indicators;
    }

    const closes = klines.map((k) => parseFloat(String(k[4])));
    const highs = klines.map((k) => parseFloat(String(k[2])));
    const lows = klines.map((k) => parseFloat(String(k[3])));
    const volumes = klines.map((k) => parseFloat(String(k[5])));

    const rsi = calculateRSI(closes);
    let rsiSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let rsiDesc = '';
    if (rsi < 30) { rsiSignal = 'bullish'; rsiDesc = 'اشباع فروش - احتمال بازگشت صعودی'; }
    else if (rsi > 70) { rsiSignal = 'bearish'; rsiDesc = 'اشباع خرید - احتمال اصلاح نزولی'; }
    else if (rsi < 45) { rsiSignal = 'bullish'; rsiDesc = 'زیر خط میانی - تمایل صعودی'; }
    else if (rsi > 55) { rsiSignal = 'bearish'; rsiDesc = 'بالای خط میانی - تمایل نزولی'; }
    else { rsiDesc = 'خنثی - بدون سیگنال مشخص'; }
    indicators.push({ name: 'RSI (14)', value: parseFloat(rsi.toFixed(2)), signal: rsiSignal, description: rsiDesc });

    const { macd, signal, histogram } = calculateMACD(closes);
    let macdSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let macdDesc = '';
    if (histogram > 0 && macd > signal) { macdSignal = 'bullish'; macdDesc = 'هیستوگرام مثبت - مومنتوم صعودی'; }
    else if (histogram < 0 && macd < signal) { macdSignal = 'bearish'; macdDesc = 'هیستوگرام منفی - مومنتوم نزولی'; }
    else { macdDesc = 'تقاطع در حال شکل‌گیری'; }
    indicators.push({ name: 'MACD (12,26,9)', value: parseFloat(histogram.toFixed(4)), signal: macdSignal, description: macdDesc });

    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const lastIdx = closes.length - 1;
    let emaSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let emaDesc = '';
    if (ema9[lastIdx] > ema21[lastIdx]) { emaSignal = 'bullish'; emaDesc = `EMA9 (${ema9[lastIdx].toFixed(2)}) بالای EMA21 (${ema21[lastIdx].toFixed(2)}) - روند صعودی`; }
    else if (ema9[lastIdx] < ema21[lastIdx]) { emaSignal = 'bearish'; emaDesc = `EMA9 (${ema9[lastIdx].toFixed(2)}) زیر EMA21 (${ema21[lastIdx].toFixed(2)}) - روند نزولی`; }
    else { emaDesc = 'EMA ها نزدیک هم - بدون روند مشخص'; }
    indicators.push({ name: 'EMA Cross (9/21)', value: parseFloat((ema9[lastIdx] - ema21[lastIdx]).toFixed(4)), signal: emaSignal, description: emaDesc });

    const bb = calculateBollingerBands(closes);
    let bbSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let bbDesc = '';
    if (bb.percentB < 0.1) { bbSignal = 'bullish'; bbDesc = 'قیمت نزدیک باند پایین - اشباع فروش'; }
    else if (bb.percentB > 0.9) { bbSignal = 'bearish'; bbDesc = 'قیمت نزدیک باند بالا - اشباع خرید'; }
    else { bbDesc = `قیمت در ${(bb.percentB * 100).toFixed(0)}% باند بولینگر`; }
    indicators.push({ name: 'Bollinger Bands', value: parseFloat(bb.percentB.toFixed(4)), signal: bbSignal, description: bbDesc });

    const atr = calculateATR(highs, lows, closes);
    const atrPercent = (atr / closes[lastIdx]) * 100;
    let atrSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let atrDesc = '';
    if (atrPercent > 3) { atrDesc = `نوسان بالا (${atrPercent.toFixed(2)}%) - احتیاط کنید`; atrSignal = 'bearish'; }
    else if (atrPercent > 1.5) { atrDesc = `نوسان متوسط (${atrPercent.toFixed(2)}%)`; }
    else { atrDesc = `نوسان پایین (${atrPercent.toFixed(2)}%)`; atrSignal = 'bullish'; }
    indicators.push({ name: 'ATR (14)', value: parseFloat(atr.toFixed(4)), signal: atrSignal, description: atrDesc });

    const adx = calculateADX(highs, lows, closes);
    let adxSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let adxDesc = '';
    if (adx > 25) { adxSignal = 'bullish'; adxDesc = `ADX ${adx.toFixed(0)} - روند قوی (بالای ۲۵)`; }
    else if (adx < 20) { adxSignal = 'bearish'; adxDesc = `ADX ${adx.toFixed(0)} - بازار رنج (زیر ۲۰) - سیگنال ضعیف`; }
    else { adxDesc = `ADX ${adx.toFixed(0)} - روند متوسط`; }
    indicators.push({ name: 'ADX (14)', value: parseFloat(adx.toFixed(2)), signal: adxSignal, description: adxDesc });

    const stochRSI = calculateStochasticRSI(closes);
    let stochSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let stochDesc = '';
    if (stochRSI.k < 20 && stochRSI.d < 20) { stochSignal = 'bullish'; stochDesc = `StochRSI K=${stochRSI.k.toFixed(0)} D=${stochRSI.d.toFixed(0)} - اشباع فروش شدید`; }
    else if (stochRSI.k > 80 && stochRSI.d > 80) { stochSignal = 'bearish'; stochDesc = `StochRSI K=${stochRSI.k.toFixed(0)} D=${stochRSI.d.toFixed(0)} - اشباع خرید شدید`; }
    else if (stochRSI.k > stochRSI.d) { stochSignal = 'bullish'; stochDesc = `StochRSI K=${stochRSI.k.toFixed(0)} > D=${stochRSI.d.toFixed(0)} - مومنتوم صعودی`; }
    else { stochSignal = 'bearish'; stochDesc = `StochRSI K=${stochRSI.k.toFixed(0)} < D=${stochRSI.d.toFixed(0)} - مومنتوم نزولی`; }
    indicators.push({ name: 'Stochastic RSI', value: parseFloat(stochRSI.k.toFixed(2)), signal: stochSignal, description: stochDesc });

    const obv = calculateOBV(closes, volumes);
    let obvDesc = '';
    if (obv.trend === 'bullish') obvDesc = 'OBV صعودی - حجم با قیمت هم‌جهت (خریداران)';
    else if (obv.trend === 'bearish') obvDesc = 'OBV نزولی - حجم فروش افزایشی';
    else obvDesc = 'OBV خنثی - بدون جهت مشخص';
    indicators.push({ name: 'OBV', value: obv.value, signal: obv.trend, description: obvDesc });

    const ichimoku = calculateIchimoku(highs, lows, closes);
    let ichiDesc = '';
    if (ichimoku.signal === 'bullish') ichiDesc = `ابر ایچیموکو: قیمت بالای ابر (تنکان=${ichimoku.tenkan.toFixed(2)}, کیجون=${ichimoku.kijun.toFixed(2)}) - صعودی قوی`;
    else if (ichimoku.signal === 'bearish') ichiDesc = `ابر ایچیموکو: قیمت زیر ابر - نزولی`;
    else ichiDesc = 'ابر ایچیموکو: قیمت داخل ابر - بدون جهت مشخص';
    indicators.push({ name: 'Ichimoku Cloud', value: ichimoku.aboveCloud ? 1 : 0, signal: ichimoku.signal, description: ichiDesc });

    const fib = calculateFibonacciLevels(highs, lows);
    const currentPrice = closes[lastIdx];
    const fibLevel = Object.entries(fib.levels).find(([, v]) => Math.abs(v - currentPrice) / currentPrice < 0.01);
    let fibSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let fibDesc = `حمایت فیبوناچی: $${fib.nearestSupport.toFixed(4)} | مقاومت: $${fib.nearestResistance.toFixed(4)}`;
    if (fibLevel) {
      fibDesc = `قیمت نزدیک سطح فیبوناچی ${fibLevel[0]} ($${fibLevel[1].toFixed(4)}) - ` + fibDesc;
      if (parseFloat(fibLevel[0]) >= 0.618) fibSignal = 'bullish';
    }
    indicators.push({ name: 'Fibonacci', value: fib.nearestSupport, signal: fibSignal, description: fibDesc });

    console.log(`[TradeAI] Analyzed ${indicators.length} indicators for ${symbol}`);
  } catch (e) {
    console.log('[TradeAI] Error analyzing indicators:', e);
  }

  return indicators;
}

function calculateTechnicalScore(indicators: IndicatorResult[]): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 50;
  let bullish = 0;
  let bearish = 0;

  for (const ind of indicators) {
    if (ind.signal === 'bullish') bullish++;
    else if (ind.signal === 'bearish') bearish++;
  }

  const total = indicators.length || 1;
  score = (bullish / total) * 100;

  const adx = indicators.find((i) => i.name.includes('ADX'));
  if (adx && adx.value > 25) {
    score += 10;
    details.push(`ADX ${adx.value.toFixed(0)} (روند قوی) +۱۰`);
  } else if (adx && adx.value < 20) {
    score -= 15;
    details.push(`ADX ${adx.value.toFixed(0)} (رنج) -۱۵`);
  }

  const obv = indicators.find((i) => i.name === 'OBV');
  if (obv?.signal === 'bullish') {
    score += 5;
    details.push('OBV صعودی +۵');
  } else if (obv?.signal === 'bearish') {
    score -= 5;
    details.push('OBV نزولی -۵');
  }

  const ichimoku = indicators.find((i) => i.name.includes('Ichimoku'));
  if (ichimoku?.signal === 'bullish') {
    score += 8;
    details.push('ایچیموکو صعودی +۸');
  } else if (ichimoku?.signal === 'bearish') {
    score -= 8;
    details.push('ایچیموکو نزولی -۸');
  }

  details.unshift(`${bullish} سیگنال صعودی از ${total} اندیکاتور`);
  return { score: Math.max(0, Math.min(100, score)), details };
}

export async function getAdvancedConfluence(
  symbol: string,
  indicators: IndicatorResult[],
  currentPrice: number,
): Promise<ConfluenceBreakdown> {
  console.log(`[TradeAI] Calculating advanced confluence for ${symbol}...`);

  const techResult = calculateTechnicalScore(indicators);

  const multiTfDetails: string[] = [];
  let multiTfScore = 0;
  try {
    const [tf15m, tf4h] = await Promise.allSettled([
      analyzeTimeframe(symbol, '15m'),
      analyzeTimeframe(symbol, '4h'),
    ]);

    const tf1h = indicators.filter((i) => i.signal === 'bullish').length > indicators.filter((i) => i.signal === 'bearish').length ? 'bullish' : 'bearish';
    const trends: string[] = [];

    if (tf15m.status === 'fulfilled') {
      trends.push(tf15m.value.trend);
      multiTfDetails.push(`۱۵ دقیقه: ${tf15m.value.trend === 'bullish' ? 'صعودی' : tf15m.value.trend === 'bearish' ? 'نزولی' : 'خنثی'}`);
    }
    trends.push(tf1h);
    multiTfDetails.push(`۱ ساعته: ${tf1h === 'bullish' ? 'صعودی' : 'نزولی'}`);

    if (tf4h.status === 'fulfilled') {
      trends.push(tf4h.value.trend);
      multiTfDetails.push(`۴ ساعته: ${tf4h.value.trend === 'bullish' ? 'صعودی' : tf4h.value.trend === 'bearish' ? 'نزولی' : 'خنثی'}`);
    }

    const allSame = trends.every((t) => t === trends[0]);
    if (allSame) {
      multiTfScore = 100;
      multiTfDetails.push('✅ تأیید چند تایم‌فریم: همگرا');
    } else {
      const bullCount = trends.filter((t) => t === 'bullish').length;
      multiTfScore = (bullCount / trends.length) * 100;
      multiTfDetails.push(`⚠️ تایم‌فریم‌ها ناهمگرا (${bullCount}/${trends.length} صعودی)`);
    }
  } catch (e) {
    console.log('[TradeAI] Multi-TF error:', e);
    multiTfDetails.push('خطا در تحلیل چند تایم‌فریم');
  }

  const derivDetails: string[] = [];
  let derivScore = 50;
  try {
    const derivData = await fetchDerivativesData(symbol);
    const fr = derivData.fundingRate;
    const lsRatio = derivData.longShortRatio;

    if (fr > 0.0005) {
      derivScore += 15;
      derivDetails.push(`Funding Rate مثبت ${(fr * 100).toFixed(4)}% (لانگ‌ها تسلط دارند)`);
    } else if (fr < -0.0005) {
      derivScore -= 15;
      derivDetails.push(`Funding Rate منفی ${(fr * 100).toFixed(4)}% (شورت‌ها تسلط دارند)`);
    } else {
      derivDetails.push(`Funding Rate خنثی ${(fr * 100).toFixed(4)}%`);
    }

    if (lsRatio > 1.2) {
      derivScore += 10;
      derivDetails.push(`L/S Ratio ${lsRatio.toFixed(2)} (غلبه لانگ‌ها)`);
    } else if (lsRatio < 0.8) {
      derivScore -= 10;
      derivDetails.push(`L/S Ratio ${lsRatio.toFixed(2)} (غلبه شورت‌ها)`);
    } else {
      derivDetails.push(`L/S Ratio ${lsRatio.toFixed(2)} (متعادل)`);
    }

    if (derivData.openInterest > 0) {
      derivDetails.push(`Open Interest: $${(derivData.openInterest).toLocaleString()}`);
    }
  } catch (e) {
    console.log('[TradeAI] Derivatives error:', e);
    derivDetails.push('خطا در دریافت داده مشتقات');
  }

  const sentimentDetails: string[] = [];
  let sentimentScore = 50;
  try {
    const coinId = symbolToCoinGeckoId(symbol);
    const sentData = await fetchSentimentData(coinId);

    sentimentScore = sentData.fearGreedIndex;
    sentimentDetails.push(`Fear & Greed: ${sentData.fearGreedIndex} (${sentData.fearGreedClassification})`);

    if (sentData.marketDominance > 0) {
      sentimentDetails.push(`تسلط بازار: ${sentData.marketDominance.toFixed(2)}%`);
    }
  } catch (e) {
    console.log('[TradeAI] Sentiment error:', e);
    sentimentDetails.push('خطا در دریافت سنتیمنت');
  }

  const onChainDetails: string[] = [];
  let onChainScore = 50;
  try {
    const coinId = symbolToCoinGeckoId(symbol);
    const ocData = await fetchOnChainData(coinId);

    if (ocData.totalVolume > 0 && ocData.marketCap > 0) {
      const volToMcap = (ocData.totalVolume / ocData.marketCap) * 100;
      if (volToMcap > 10) {
        onChainScore += 15;
        onChainDetails.push(`حجم/مارکت‌کپ ${volToMcap.toFixed(1)}% (فعالیت بالا)`);
      } else {
        onChainDetails.push(`حجم/مارکت‌کپ ${volToMcap.toFixed(1)}%`);
      }
    }

    if (ocData.priceChange7d > 5) {
      onChainScore += 10;
      onChainDetails.push(`تغییر ۷ روزه: +${ocData.priceChange7d.toFixed(1)}% (صعودی)`);
    } else if (ocData.priceChange7d < -5) {
      onChainScore -= 10;
      onChainDetails.push(`تغییر ۷ روزه: ${ocData.priceChange7d.toFixed(1)}% (نزولی)`);
    } else {
      onChainDetails.push(`تغییر ۷ روزه: ${ocData.priceChange7d.toFixed(1)}%`);
    }

    if (ocData.priceChange30d !== 0) {
      onChainDetails.push(`تغییر ۳۰ روزه: ${ocData.priceChange30d.toFixed(1)}%`);
    }

    if (ocData.athChangePercent < -80) {
      onChainScore += 10;
      onChainDetails.push(`فاصله از ATH: ${ocData.athChangePercent.toFixed(0)}% (پتانسیل رشد)`);
    }

    if (ocData.marketCap > 0) {
      onChainDetails.push(`مارکت‌کپ: $${(ocData.marketCap / 1e6).toFixed(0)}M`);
    }
  } catch (e) {
    console.log('[TradeAI] On-chain error:', e);
    onChainDetails.push('خطا در دریافت داده آنچین');
  }

  return {
    technical: Math.max(0, Math.min(100, techResult.score)),
    onChain: Math.max(0, Math.min(100, onChainScore)),
    sentiment: Math.max(0, Math.min(100, sentimentScore)),
    derivatives: Math.max(0, Math.min(100, derivScore)),
    multiTimeframe: Math.max(0, Math.min(100, multiTfScore)),
    details: {
      technical: techResult.details,
      onChain: onChainDetails,
      sentiment: sentimentDetails,
      derivatives: derivDetails,
      multiTimeframe: multiTfDetails,
    },
  };
}

export function calculateConfidenceFromConfluence(confluence: ConfluenceBreakdown): number {
  const weights = {
    technical: 0.40,
    onChain: 0.25,
    sentiment: 0.15,
    derivatives: 0.10,
    multiTimeframe: 0.10,
  };

  const score =
    confluence.technical * weights.technical +
    confluence.onChain * weights.onChain +
    confluence.sentiment * weights.sentiment +
    confluence.derivatives * weights.derivatives +
    confluence.multiTimeframe * weights.multiTimeframe;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function getAITradeSignal(
  symbol: string,
  strategy: TradingStrategy,
  currentPrice: number,
  priceChange24h: number,
  volume24h: number,
  useVolumeOnly: boolean = false,
): Promise<AITradeSignal | null> {
  console.log(`[TradeAI] Getting AI signal for ${symbol} with ${strategy} strategy (volumeOnly=${useVolumeOnly})`);

  try {
    const indicators = await analyzeIndicators(symbol);
    if (indicators.length === 0) return null;

    const config = STRATEGY_CONFIGS[strategy];
    const bullishCount = indicators.filter((i) => i.signal === 'bullish').length;
    const bearishCount = indicators.filter((i) => i.signal === 'bearish').length;

    let confluence: ConfluenceBreakdown | undefined;
    let confluenceSummary = '';

    if (!useVolumeOnly) {
      confluence = await getAdvancedConfluence(symbol, indicators, currentPrice);
      const confScore = calculateConfidenceFromConfluence(confluence);

      confluenceSummary = `
Confluence Analysis (Total Score: ${confScore}%):
- Technical: ${confluence.technical.toFixed(0)}/100 (weight 40%) → ${confluence.details.technical.join(', ')}
- On-Chain: ${confluence.onChain.toFixed(0)}/100 (weight 25%) → ${confluence.details.onChain.join(', ')}
- Sentiment: ${confluence.sentiment.toFixed(0)}/100 (weight 15%) → ${confluence.details.sentiment.join(', ')}
- Derivatives: ${confluence.derivatives.toFixed(0)}/100 (weight 10%) → ${confluence.details.derivatives.join(', ')}
- Multi-Timeframe: ${confluence.multiTimeframe.toFixed(0)}/100 (weight 10%) → ${confluence.details.multiTimeframe.join(', ')}

IMPORTANT: Use this confluence score to determine confidence. Only recommend entry if score > 70.
Scoring breakdown:
- ≥82: High Conviction (strong entry)
- 70-81: Good Setup (cautious entry)
- 55-69: Marginal (watch only)
- <55: Avoid/Counter-trend`;
    }

    const indicatorSummary = indicators
      .map((i) => `${i.name}: ${i.value} (${i.signal}) - ${i.description}`)
      .join('\n');

    const atr = indicators.find((i) => i.name === 'ATR (14)');
    const atrValue = atr ? atr.value : currentPrice * 0.02;

    const result = await generateObject({
      messages: [
        {
          role: 'user',
          content: `You are an expert crypto trader AI assistant. Analyze the following market data and provide a trading signal.

Symbol: ${symbol}
Current Price: $${currentPrice}
24h Price Change: ${priceChange24h.toFixed(2)}%
24h Volume: $${volume24h.toLocaleString()}
Strategy: ${config.nameEn} (Max Leverage: ${config.maxLeverage}x, Stop Loss: ${config.stopLossPercent}%)
ATR Value: $${atrValue.toFixed(4)}

Technical Indicators (${indicators.length} total):
${indicatorSummary}

Bullish signals: ${bullishCount}/${indicators.length}
Bearish signals: ${bearishCount}/${indicators.length}
${confluenceSummary}

RULES:
1. Set stop loss based on ATR × 1.5-2 (not fixed percentage)
2. Risk/Reward must be at least 1:2
3. If confluence score < 70, action MUST be 'hold'
4. Provide reasoning in Persian (Farsi) with detailed analysis
5. Include confluence breakdown in reasoning
6. Confidence must reflect the confluence score`,
        },
      ],
      schema: z.object({
        action: z.enum(['buy', 'sell', 'hold']),
        confidence: z.number().min(0).max(100),
        entryPrice: z.number(),
        targetPrice: z.number(),
        stopLoss: z.number(),
        leverage: z.number().min(1).max(config.maxLeverage),
        timeframe: z.string(),
        reasoning: z.string(),
      }),
    });

    const riskReward =
      result.action !== 'hold' && result.stopLoss > 0
        ? Math.abs(result.targetPrice - result.entryPrice) / Math.abs(result.entryPrice - result.stopLoss)
        : 0;

    const signal: AITradeSignal = {
      id: `ai-${symbol}-${Date.now()}`,
      symbol,
      action: result.action,
      confidence: result.confidence,
      strategy,
      entryPrice: result.entryPrice,
      targetPrice: result.targetPrice,
      stopLoss: result.stopLoss,
      leverage: result.leverage,
      reasoning: result.reasoning,
      indicators,
      timestamp: Date.now(),
      timeframe: result.timeframe,
      riskReward: parseFloat(riskReward.toFixed(2)),
      confluence,
    };

    console.log(`[TradeAI] AI signal: ${signal.action} with ${signal.confidence}% confidence`);
    return signal;
  } catch (e) {
    console.log('[TradeAI] Error getting AI signal:', e);
    return null;
  }
}

export function createDemoPortfolio(initialBalance: number = 10000): DemoPortfolio {
  return {
    balance: initialBalance,
    initialBalance,
    positions: [],
    closedTrades: [],
    totalPnl: 0,
    winRate: 0,
    totalTrades: 0,
  };
}

export function openDemoPosition(
  portfolio: DemoPortfolio,
  signal: AITradeSignal,
  amount: number,
): DemoPortfolio {
  if (amount > portfolio.balance) {
    console.log('[TradeAI] Insufficient demo balance');
    return portfolio;
  }

  const position: DemoPosition = {
    id: `demo-${Date.now()}`,
    symbol: signal.symbol,
    side: signal.action === 'buy' ? 'long' : 'short',
    entryPrice: signal.entryPrice,
    currentPrice: signal.entryPrice,
    size: (amount * signal.leverage) / signal.entryPrice,
    leverage: signal.leverage,
    pnl: 0,
    pnlPercent: 0,
    openedAt: Date.now(),
    stopLoss: signal.stopLoss,
    takeProfit: signal.targetPrice,
  };

  return {
    ...portfolio,
    balance: portfolio.balance - amount,
    positions: [...portfolio.positions, position],
  };
}

export function closeDemoPosition(
  portfolio: DemoPortfolio,
  positionId: string,
  currentPrice: number,
  reason: ClosedTrade['reason'] = 'manual',
): DemoPortfolio {
  const position = portfolio.positions.find((p) => p.id === positionId);
  if (!position) return portfolio;

  const priceDiff = position.side === 'long'
    ? (currentPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - currentPrice) / position.entryPrice;
  const pnl = priceDiff * position.size * position.entryPrice;
  const margin = (position.size * position.entryPrice) / position.leverage;

  const closedTrade: ClosedTrade = {
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: currentPrice,
    size: position.size,
    leverage: position.leverage,
    pnl,
    pnlPercent: priceDiff * 100 * position.leverage,
    openedAt: position.openedAt,
    closedAt: Date.now(),
    reason,
  };

  const closedTrades = [...portfolio.closedTrades, closedTrade];
  const wins = closedTrades.filter((t) => t.pnl > 0).length;
  const totalTrades = closedTrades.length;

  return {
    ...portfolio,
    balance: portfolio.balance + margin + pnl,
    positions: portfolio.positions.filter((p) => p.id !== positionId),
    closedTrades,
    totalPnl: closedTrades.reduce((sum, t) => sum + t.pnl, 0),
    winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    totalTrades,
  };
}

export function updateDemoPositions(
  portfolio: DemoPortfolio,
  prices: Record<string, number>,
): DemoPortfolio {
  let updatedPortfolio = { ...portfolio };
  const updatedPositions = portfolio.positions.map((pos) => {
    const cleanSymbol = pos.symbol.replace('/USDT', 'USDT');
    const currentPrice = prices[cleanSymbol] ?? pos.currentPrice;
    const priceDiff = pos.side === 'long'
      ? (currentPrice - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - currentPrice) / pos.entryPrice;

    return {
      ...pos,
      currentPrice,
      pnl: priceDiff * pos.size * pos.entryPrice,
      pnlPercent: priceDiff * 100 * pos.leverage,
    };
  });

  const positionsToClose: string[] = [];
  for (const pos of updatedPositions) {
    if (pos.side === 'long') {
      if (pos.currentPrice >= pos.takeProfit) positionsToClose.push(pos.id);
      else if (pos.currentPrice <= pos.stopLoss) positionsToClose.push(pos.id);
    } else {
      if (pos.currentPrice <= pos.takeProfit) positionsToClose.push(pos.id);
      else if (pos.currentPrice >= pos.stopLoss) positionsToClose.push(pos.id);
    }
  }

  updatedPortfolio = { ...updatedPortfolio, positions: updatedPositions };

  for (const posId of positionsToClose) {
    const pos = updatedPortfolio.positions.find((p) => p.id === posId);
    if (pos) {
      const isTP = pos.side === 'long' ? pos.currentPrice >= pos.takeProfit : pos.currentPrice <= pos.takeProfit;
      updatedPortfolio = closeDemoPosition(updatedPortfolio, posId, pos.currentPrice, isTP ? 'tp' : 'sl');
      console.log(`[TradeAI] Auto-closed demo position ${posId} (${isTP ? 'TP' : 'SL'})`);
    }
  }

  return updatedPortfolio;
}
