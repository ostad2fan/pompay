/**
 * utils/feasibilityCalculator.ts — v1.5.7
 *
 * R9 — «یه بخشی برا بک‌تست واقعی که صرافی + نوع استراتژی + تعداد معاملات در
 * روز + لوریج + حجم مارجین کل + حجم هر معامله + حد ضرر + ریوارد + حد ضرر
 * روزانه را بدهم و محاسبه کند آیا طبق کارمزد فیوچرز آن صرافی می‌صرفد ربات
 * را روی آن صرافی اجرا کنم یا نه — و اگر نه، خودش اعداد تنظیمات را پیشنهاد بدهد».
 *
 * منطق ریاضی (همان موتور ربات):
 *   • مارجین هر معامله = حجم دلاری ÷ لوریج
 *   • ریسک هر معامله ($) = مارجین × درصد حدضرر → فاصله قیمت = ضرر ÷ لوریج
 *   • سود هر معامله ($) = ریسک × ریوارد
 *   • کارمزد رفت‌وبرگشت = ۲ × حجم × (کارمزد تیکر + کارمزد میکر) ÷ ۲ (محافظه‌کارانه:
 *     ورود و خروج هر دو تیکر در نظر گرفته می‌شود؛ با سفارش لیمیت میکر ارزان‌تر است)
 *   • EV هر معامله = نرخ‌برد × سود − (۱−نرخ‌برد) × ریسک − کارمزد
 *   • نرخ‌برد سربه‌سر = (ریسک + کارمزد) ÷ (سود + ریسک)
 *   • حد ضرر روزانه: تعداد باختِ قابل‌تحمل = (مارجین کل × درصد حدضرر روزانه) ÷ ریسک
 *
 * توابع خالص‌اند تا در تست Node (scripts/test-feasibility.cjs) قابل بررسی باشند.
 */

export interface ExchangeFeeProfile {
  id: string;
  name: string;
  /** درصد — VIP0 (بدون تخفیف توکن صرافی). */
  takerPercent: number;
  makerPercent: number;
  /** نکته نمایشی (تخفیف توکن و…). */
  note?: string;
}

/**
 * کارمزد فیوچرز USDT-M سطح عادی (VIP0) — منبع: صفحه رسمی کارمزد هر صرافی
 * (۲۰۲۵/۲۰۲۶). اعداد تقریبی‌اند و در UI هم قابل ویرایش‌اند؛ توکن صرافی
 * (BNB/BGB/MX…) معمولاً ۱۰-۲۰٪ تخفیف می‌دهد.
 */
export const EXCHANGE_FEE_PROFILES: ExchangeFeeProfile[] = [
  { id: 'binance', name: 'بایننس (Binance)', takerPercent: 0.05, makerPercent: 0.02, note: 'با پرداخت کارمزد با BNB حدود ۱۰٪ ارزان‌تر' },
  { id: 'bybit', name: 'بای‌بیت (Bybit)', takerPercent: 0.055, makerPercent: 0.02 },
  { id: 'okx', name: 'OKX', takerPercent: 0.05, makerPercent: 0.02 },
  { id: 'kucoin', name: 'کوکوین (KuCoin)', takerPercent: 0.06, makerPercent: 0.02 },
  { id: 'bitget', name: 'بیت‌گت (Bitget)', takerPercent: 0.06, makerPercent: 0.02, note: 'توکن BGB تخفیف می‌دهد' },
  { id: 'gateio', name: 'گیت (Gate.io)', takerPercent: 0.05, makerPercent: 0.02 },
  { id: 'mexc', name: 'مکسی (MEXC)', takerPercent: 0.06, makerPercent: 0.02, note: 'گاهی پروموشن کارمزد صفر دارد' },
  { id: 'lbank', name: 'البانک (LBank)', takerPercent: 0.05, makerPercent: 0.02 },
  { id: 'xt', name: 'XT.com', takerPercent: 0.05, makerPercent: 0.02 },
  { id: 'hyperliquid', name: 'هایپرلیکوئید (Hyperliquid)', takerPercent: 0.045, makerPercent: 0.015 },
  { id: 'custom', name: 'سایر / دستی', takerPercent: 0.05, makerPercent: 0.02, note: 'کارمزد را خودتان وارد کنید' },
];

export interface FeasibilityInput {
  /** درصد کارمزد تیکر — از پروفایل صرافی، قابل ویرایش. */
  takerPercent: number;
  makerPercent: number;
  /** تعداد معاملات در روز. */
  tradesPerDay: number;
  leverage: number;
  /** مارجین کل حساب (دلار). */
  totalMarginUsd: number;
  /** حجم دلاری (notional) هر معامله. */
  volumePerTradeUsd: number;
  /** درصد حد ضرر (روی مارجین هر معامله — مثل موتور ربات). */
  slPercent: number;
  /** ریوارد (R:R). */
  rewardRatio: number;
  /** درصد حد ضرر روزانه (روی کل مارجین). */
  dailyLossPercent: number;
  /** حدس نرخ برد کاربر (٪) — پیش‌فرض ۵۰. */
  winRatePercent: number;
  /** سفارش‌ها: taker = market؛ maker = limit (ورود/خروج میکر). */
  entryStyle: 'taker' | 'mixed';
}

export interface FeasibilityResult {
  ok: boolean;
  /** مارجین هر معامله ($). */
  marginPerTrade: number;
  /** ریسک $ هر معامله (ضرر حساب در استاپ). */
  riskPerTrade: number;
  /** سود $ هر معامله در تیک‌پرافیت. */
  rewardPerTrade: number;
  /** کارمزد $ هر رفت‌وبرگشت. */
  feePerTrade: number;
  /** نسبت کارمزد به ریسک (٪) — کارمزد چند درصدِ ریسک است. */
  feeToRiskPercent: number;
  /** امید ریاضی هر معامله ($) — با نرخ‌برد کاربر. */
  evPerTrade: number;
  /** EV روزانه ($). */
  evPerDay: number;
  /** کارمزد روزانه ($). */
  feesPerDay: number;
  /** نرخ‌برد سربه‌سر (٪) — بالاتر از آن سود، پایین‌تر ضرر. */
  breakevenWinRate: number;
  /** حاشیه‌ی نرخ‌برد کاربر نسبت به سربه‌سر (پوینت). */
  winRateMarginPoints: number;
  /** حداکثر تعداد باخت قبل از حد ضرر روزانه. */
  lossesUntilDailyStop: number;
  /** آیا حجم معامله در مارجین کل جا می‌شود (حداقل ۲ برابر ضریب اطمینان). */
  marginOk: boolean;
  /** پیام‌های راهنما/هشدار. */
  warnings: string[];
  /** اگر ok=false: پیشنهادهای عددی تا سربه‌سر شدن. */
  suggestions: FeasibilitySuggestion[];
  /** بهترین صرافی از نظر کارمزد (بالاترین EV روزانه) از لیست پروفایل‌ها. */
  bestExchange?: ExchangeFeeProfile;
}

export interface FeasibilitySuggestion {
  /** توضیح فارسی کوتاه. */
  text: string;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function computeFeasibility(input: FeasibilityInput): FeasibilityResult {
  const {
    takerPercent,
    makerPercent,
    tradesPerDay,
    leverage,
    totalMarginUsd,
    volumePerTradeUsd,
    slPercent,
    rewardRatio,
    dailyLossPercent,
    winRatePercent,
    entryStyle,
  } = input;

  const lev = Math.max(1, leverage || 1);
  const taker = Math.max(0, takerPercent) / 100;
  const maker = Math.max(0, makerPercent) / 100;
  // mixed = ورود تیکر (سیگنال بازار) + خروج تیکر (استاپ) → محافظه‌کارانه هر دو
  // تیکر؛ برای entryStyle='mixed' میانگین میکر/تیکر برای خروجِ تیک‌پرافیت فرض
  // شده (خروج در هدف با لیمیت). ساده و نزدیک به واقع: تیکر برای ورود، و برای
  // خروج نصف میکر نصف تیکر.
  const exitRate = entryStyle === 'taker' ? taker : (taker + maker) / 2;
  const feePerTrade = volumePerTradeUsd * (taker + exitRate);

  const marginPerTrade = volumePerTradeUsd / lev;
  const riskPerTrade = marginPerTrade * (Math.max(0.1, slPercent) / 100);
  const rewardPerTrade = riskPerTrade * Math.max(0.1, rewardRatio || 1);

  const w = Math.min(100, Math.max(0, winRatePercent)) / 100;
  const evPerTrade = w * rewardPerTrade - (1 - w) * riskPerTrade - feePerTrade;
  const evPerDay = evPerTrade * Math.max(0, tradesPerDay);
  const feesPerDay = feePerTrade * Math.max(0, tradesPerDay);

  const breakevenWinRate =
    rewardPerTrade + riskPerTrade > 0
      ? ((riskPerTrade + feePerTrade) / (rewardPerTrade + riskPerTrade)) * 100
      : 100;
  const winRateMarginPoints = winRatePercent - breakevenWinRate;

  const dailyLossBudget = totalMarginUsd * (Math.max(0, dailyLossPercent) / 100);
  const lossesUntilDailyStop = riskPerTrade > 0 ? Math.floor(dailyLossBudget / riskPerTrade) : 0;

  const marginOk = marginPerTrade > 0 && marginPerTrade * 2 <= totalMarginUsd;

  const warnings: string[] = [];
  if (!marginOk) {
    warnings.push(
      `حجم هر معامله با لوریج ${lev}x مارجین ${round(marginPerTrade)}$ می‌گیرد — دو برابر آن (${round(
        marginPerTrade * 2
      )}$) در مارجین کل (${round(totalMarginUsd, 0)}$) جا نمی‌شود؛ حجم را کم یا لوریج را زیاد کنید.`
    );
  }
  if (lossesUntilDailyStop < 3) {
    warnings.push(
      `با حد ضرر روزانه ${dailyLossPercent}٪ فقط ${lossesUntilDailyStop} باخت پیاپی تا توقف روزانه فاصله دارید — حد ضرر روزانه را بیشتر یا ریسک هر معامله را کمتر کنید.`
    );
  }
  const feeShareOfRisk = riskPerTrade > 0 ? (feePerTrade / riskPerTrade) * 100 : 100;
  if (feeShareOfRisk > 30) {
    warnings.push(
      `کارمزد رفت‌وبرگشت (${round(feePerTrade, 3)}$) ${round(feeShareOfRisk, 0)}٪ِ ریسک هر معامله است — کارمزد به‌سرعت سود را می‌خورد (پیشنهاد: حدضرر بزرگ‌تر یا صرافی ارزان‌تر).`
    );
  }
  if (tradesPerDay > 40) {
    warnings.push('بیش از ۴۰ معامله در روز: کارمزدها و لغزش قیمت (اسلیپیج) نقش بزرگ می‌گیرند — اعداد واقعی معمولاً بدتر از محاسبه‌اند.');
  }

  // حکم: EV روزانه مثبت + حاشیه نرخ‌برد حداقل ۵ پوینت + مارجین جا شود.
  const ok = evPerDay > 0 && winRateMarginPoints >= 5 && marginOk && lossesUntilDailyStop >= 2;

  const suggestions: FeasibilitySuggestion[] = [];
  if (!ok) {
    // ۱) ریوارد لازم برای سربه‌سر (سطح نرخ‌برد فعلی)
    const rrNeeded =
      w > 0 ? ((1 - w) * riskPerTrade + feePerTrade) / (w * riskPerTrade) : Infinity;
    if (Number.isFinite(rrNeeded) && rrNeeded > rewardRatio) {
      suggestions.push({
        text: `ریوارد (R:R) را از ${round(rewardRatio, 2)} به حداقل ${round(rrNeeded * 1.15, 2)} برسانید تا با نرخ‌برد ${winRatePercent}٪ سربه‌سر/سودده شود.`,
      });
    }
    // ۲) نرخ‌برد لازم با ریوارد فعلی
    if (breakevenWinRate > winRatePercent) {
      suggestions.push({
        text: `یا نرخ‌برد واقعی شما باید حداقل ${round(breakevenWinRate + 5, 0)}٪ باشد (سربه‌سر ${round(
          breakevenWinRate,
          0
        )}٪ + حاشیه ۵) تا این تنظیمات سودده شود.`,
      });
    }
    // ۳) حدضرر بزرگ‌تر = کارمزد نسبت به ریسک کوچک‌تر
    const slNeeded = (feePerTrade / (0.25 * marginPerTrade)) * 100; // کارمزد ≤ ۲۵٪ ریسک
    if (slNeeded > slPercent) {
      suggestions.push({
        text: `حد ضرر را از ${slPercent}٪ به حدود ${round(slNeeded, 1)}٪ افزایش دهید تا سهم کارمزد از ریسک به ~۲۵٪ برسد (فاصله قیمت استاپ = ضرر ÷ لوریج).`,
      });
    }
    // ۴) حجم/تعداد: کارمزد روزانه نصفِ EV ناخالص یا کمتر
    if (tradesPerDay > 1) {
      const grossDay = tradesPerDay * (w * rewardPerTrade - (1 - w) * riskPerTrade);
      const tNeeded = grossDay > 0 ? Math.max(1, Math.floor((grossDay / 2) / feePerTrade)) : 1;
      if (tNeeded < tradesPerDay) {
        suggestions.push({
          text: `تعداد معاملات روزانه را به ~${tNeeded} کاهش دهید تا مجموع کارمزد روزانه از نصفِ سود ناخالص بیشتر نشود (کیفیت سیگنال به‌جای تعداد).`,
        });
      }
    }
    // ۵) صرافی ارزان‌تر
    const best = EXCHANGE_FEE_PROFILES.filter((e) => e.id !== 'custom').sort(
      (a, b) => a.takerPercent + a.makerPercent - (b.takerPercent + b.makerPercent)
    )[0];
    if (best && best.takerPercent < takerPercent) {
      suggestions.push({
        text: `در ${best.name} کارمزد تیکر ${best.takerPercent}٪ است (به‌جای ${takerPercent}٪) — تنها جابه‌جایی صرافی روزانه ~${round(
          tradesPerDay * volumePerTradeUsd * ((takerPercent - best.takerPercent) / 100) * 2,
          2
        )}$ کارمزد کم می‌کند.`,
      });
    }
    // ۶) سفارش لیمیت (میکر) در ورود
    if (entryStyle === 'taker' && maker < taker) {
      suggestions.push({
        text: `ورود با سفارش لیمیت (میکر ${makerPercent}٪) به‌جای مارکت، هر رفت‌وبرگشت ~${round(
          volumePerTradeUsd * ((taker - maker) / 100) * 2,
          3
        )}$ ارزان‌تر می‌شود.`,
      });
    }
  }

  return {
    ok,
    marginPerTrade: round(marginPerTrade),
    riskPerTrade: round(riskPerTrade),
    rewardPerTrade: round(rewardPerTrade),
    feePerTrade: round(feePerTrade, 3),
    feeToRiskPercent: riskPerTrade > 0 ? round((feePerTrade / riskPerTrade) * 100, 0) : 100,
    evPerTrade: round(evPerTrade, 3),
    evPerDay: round(evPerDay, 2),
    feesPerDay: round(feesPerDay, 2),
    breakevenWinRate: round(breakevenWinRate, 1),
    winRateMarginPoints: round(winRateMarginPoints, 1),
    lossesUntilDailyStop,
    marginOk,
    warnings,
    suggestions,
    bestExchange: EXCHANGE_FEE_PROFILES.filter((e) => e.id !== 'custom').sort(
      (a, b) => a.takerPercent + a.makerPercent - (b.takerPercent + b.makerPercent)
    )[0],
  };
}
