/**
 * backtestPdf.ts — v1.5.4 → v1.5.11
 *
 * «در بک تست بتونم کل تاریخچه را در هر تایم‌فریمی که انتخاب می‌کنم به‌صورت
 * پی‌دی‌اف دانلود کنم یا اشتراک‌گذارم و در پی‌دی‌اف تمام مشخصات پوزیشن
 * مثل نام، نقطه ورود، استاپ، تی‌پی، حجم مارجین، نوع بسته شدن (دستی / تیک
 * پروفیت / استاپ / بستن بخش حجم) باشد»
 *
 * v1.5.11 — «کاری کن سریعتر ساخته بشه؛ اگه لازمه فقط متنو جداول باشن از
 * بکگراند استفاده نکن» (PDF هفت‌روزه اصلا ساخته نمی‌شد — ۱ ساعت انتظار):
 *  • قالب «چاپ سریع»: پس‌زمینه سفید، بدون کارت/گرادیان/بک‌گراند — فقط
 *    متن و جدول (طبق اجازه‌ی خود کاربر).
 *  • جدول اصلی «تکه‌تکه» می‌شود: هر ۴۰ ردیف یک <table> جدا با تکرار
 *    سربرگ — موتور چاپ اندروید جدول‌های کوچک را صدها برابر سریع‌تر
 *    صفحه‌بندی می‌کند (ریشه‌ی هنگِ ۱ ساعته: یک جدول غول‌پیکر با
 *    border-collapse).
 *  • فقط خطوط افقی (بدون خط عمودی سلول‌ها)، فونت ریز، سربرگِ قابل
 *    شکستن (بدون white-space:nowrap) → جدول در عرض صفحه جا می‌شود.
 *  • بدون ایموجی در سند (شکل‌دهی فونت ارزان‌تر).
 *  • همه‌ی ۱۴ ستون + «قیمت خروج» حفظ شدند؛ ۳۰ روز/«همه» مثل قبل فقط
 *    خلاصه‌ی آمار (درخواست قبلی کاربر).
 *
 * سازنده‌ی HTML راست‌به‌چپ فارسی برای expo-print (printToFileAsync → PDF).
 * تابع خالص است تا هم در اپ و هم در تست قابل استفاده باشد.
 */

export interface BacktestPdfRow {
  symbol: string;
  side: 'long' | 'short';
  strategyName?: string;
  sourceLabel?: string;
  entryPrice: number;
  stopPrice: number;
  takePrice: number;
  /** مارجین ورودی (دلاری). */
  marginUsd: number;
  /** سایز پوزیشن (تعداد کوین). */
  qty: number;
  leverage: number;
  openedAt: number;
  closedAt?: number;
  closeReason?: string;
  realizedPnl?: number;
  /** قیمت‌های ازپیش‌قالب‌بندی‌شده با دقت بایننس. */
  entryText: string;
  stopText: string;
  takeText: string;
  /** v1.5.10 — قیمت خروج (قیمت لحظه‌ی بسته شدن) ازپیش‌قالب‌بندی‌شده. */
  exitText?: string;
  /** v1.5.12 — «کارمزد + فاندینگ» پوزیشن واقعی (مثلاً «ف 0.35 + ک 0.12») — دمو خالی. */
  feesText?: string;
}

export interface BacktestPdfMeta {
  mode: 'demo' | 'real';
  periodLabel: string;
  filterLabel: string;
  initialCapitalUsd: number;
  /** مارجین درگیر در پوزیشن‌های باز. */
  engagedMarginUsd: number;
  /** PnL بازِ لحظه‌ای. */
  openPnlUsd: number;
  generatedAt: number;
  /**
   * v1.5.8 — طول بازه‌ی انتخابی به روز (امروز=۱، ۷روز=۷، ۳۰روز=۳۰،
   * همه=Infinity). <= ۷ → جدول ریز معاملات؛ بیشتر → فقط خلاصه.
   */
  windowDays?: number;
  /**
   * v1.5.12 — آمار «کلِ» بازه حتی وقتی جدول به سقف ردیف بریده شده
   * (جمع‌های کارت آمار همیشه شامل همه‌ی معاملات همان بازه است).
   */
  fullStats?: { trades: number; wins: number; losses: number; realized: number };
  /** v1.5.12 — یادداشت بریده‌شدن جدول (سقف ۸۰۰ ردیف برای سرعتِ چاپ). */
  truncatedNote?: string;
}

/** v1.5.11 — اندازه‌ی هر تکه از جدول (ردیف در هر <table>). */
export const PDF_TABLE_CHUNK = 40;

const PERSIAN_CLOSE_REASON: Record<string, string> = {
  stop: 'استاپ‌لاس',
  take: 'تیک‌پرافیت',
  manual: 'بستن دستی',
  'whale-close': 'بستن نهنگ',
  signal: 'سیگنال',
  partial: 'برداشت سود (بستن بخشی از حجم)',
  'partial-manual': 'بستن حجمی دستی',
};

function faDateTime(ms?: number): string {
  if (!ms) return '—';
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.toLocaleDateString('fa-IR')} ${hh}:${mm}`;
  } catch {
    return '—';
  }
}

function usd(n: number, digits = 2): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * v1.5.11 — ردیف کامل، فقط کلاس CSS (بدون استایل درون‌خطی و بدون
 * بک‌گراند) — ساخت رشته با join یک‌باره.
 */
function fullRowHtml(r: BacktestPdfRow, i: number): string {
  const pnl = r.realizedPnl ?? 0;
  const reason = PERSIAN_CLOSE_REASON[r.closeReason ?? ''] ?? (r.closeReason ? r.closeReason : '—');
  const exit = r.exitText && r.exitText.length > 0 ? r.exitText : '—';
  // v1.5.12 — «کارمزد + فاندینگ» زیر سود/زیان (فقط ترید واقعی که کارمزد کم شده)
  const fees = r.feesText && r.feesText.length > 0 ? `<br/><span class="fee">${r.feesText}</span>` : '';
  return (
    `<tr><td>${(i + 1).toLocaleString('fa-IR')}</td>` +
    `<td class="b">${r.symbol}</td>` +
    `<td class="${r.side === 'long' ? 'g' : 'r'} b">${r.side === 'long' ? 'لانگ' : 'شورت'} ${r.leverage.toLocaleString('fa-IR')}x</td>` +
    `<td>${r.strategyName ?? '—'}</td>` +
    `<td>${r.sourceLabel ?? '—'}</td>` +
    `<td class="mono">${r.entryText}</td>` +
    `<td class="mono">${r.stopText}</td>` +
    `<td class="mono">${r.takeText}</td>` +
    `<td class="mono">${exit}</td>` +
    `<td class="mono">$${usd(r.marginUsd)}</td>` +
    `<td>${faDateTime(r.openedAt)}</td>` +
    `<td>${faDateTime(r.closedAt)}</td>` +
    `<td>${reason}</td>` +
    `<td class="mono b ${pnl >= 0 ? 'g' : 'r'}">${pnl >= 0 ? '+' : '−'}$${usd(pnl)}${fees}</td></tr>`
  );
}

const FULL_TABLE_HEAD =
  '<tr><th>#</th><th>ارز</th><th>جهت / لوریج</th><th>استراتژی</th><th>اندیکاتور/منبع</th>' +
  '<th>نقطه ورود</th><th>استاپ</th><th>تیک‌پرافیت</th><th>قیمت خروج</th><th>حجم مارجین</th>' +
  '<th>باز شد</th><th>بسته شد</th><th>نوع بسته شدن</th><th>سود/زیان</th></tr>';

/** ساخت HTML گزارش PDF تاریخچه بک‌تست — قالب چاپ سریع v1.5.11 (RTL فارسی). */
export function buildBacktestPdfHtml(rows: BacktestPdfRow[], meta: BacktestPdfMeta): string {
  // v1.5.12 — آمار از «کلِ» بازه (fullStats) وقتی جدول بریده شده است؛
  // وگرنه از همان ردیف‌های جدول.
  const st = meta.fullStats;
  const totalTrades = st ? st.trades : rows.length;
  const wins = st ? st.wins : rows.filter((r) => (r.realizedPnl ?? 0) >= 0).length;
  const losses = st ? st.losses : totalTrades - wins;
  const realized = st ? st.realized : rows.reduce((s, r) => s + (r.realizedPnl ?? 0), 0);
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const balance = meta.initialCapitalUsd + realized;
  const freeMargin = Math.max(0, balance - meta.engagedMarginUsd);

  // v1.5.8 — R3: در بازه‌های بیشتر از ۷ روز، ریز معاملات در PDF درج
  // نمی‌شود («در تایم‌های بالاتر لازم نیست ریز معاملات ساخته بشه»).
  const windowDays = meta.windowDays ?? 1;
  const includeTrades = Number.isFinite(windowDays) ? windowDays <= 7 : false;

  // v1.5.11 — جدول‌های تکه‌تکه‌ی ۴۰ ردیفی (چاپ سریع اندروید)
  // v1.5.12 — جدول از «rows» ساخته می‌شود (سقف ۸۰۰ ردیف آخر)؛ totalTrades فقط
  // آمار کارت است — پیمایش روی totalTrades به undefined می‌رسید (تست گرفتش).
  let tablesHtml = '';
  if (includeTrades && rows.length > 0) {
    const parts: string[] = [];
    for (let start = 0; start < rows.length; start += PDF_TABLE_CHUNK) {
      const end = Math.min(start + PDF_TABLE_CHUNK, rows.length);
      const chunk: string[] = [];
      for (let i = start; i < end; i++) chunk.push(fullRowHtml(rows[i], i));
      parts.push(`<table class="t"><thead>${FULL_TABLE_HEAD}</thead><tbody>${chunk.join('')}</tbody></table>`);
    }
    tablesHtml = parts.join('');
  }

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: Tahoma, 'Segoe UI', sans-serif; color: #000; background: #fff; margin: 10px 12px; font-size: 10px; }
  h1 { font-size: 14px; margin: 0 0 2px; }
  .sub { font-size: 8.5px; color: #555; margin: 0 0 8px; }
  .stats { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .stats td { width: 33.33%; border: 1px solid #999; padding: 3px 5px; font-size: 8.5px; }
  .stats .k { display: block; color: #555; font-size: 7.5px; }
  .stats .v { display: block; font-weight: 700; direction: ltr; text-align: right; font-size: 10px; }
  .g { color: #0a7a45; }
  .r { color: #a32222; }
  table.t { width: 100%; border-collapse: collapse; font-size: 7.5px; margin: 0 0 10px 0; }
  th { border-top: 1.2px solid #000; border-bottom: 1.2px solid #000; padding: 3px 2px; font-size: 7px; text-align: center; }
  td { border-bottom: 0.4px solid #bbb; padding: 2px 2px; text-align: center; vertical-align: middle; }
  .b { font-weight: 700; }
  .mono { font-family: 'Courier New', monospace; direction: ltr; }
  .empty { text-align: center; color: #555; padding: 14px; font-size: 9px; }
  .note { font-size: 8px; color: #333; border: 1px solid #999; padding: 5px 7px; margin: 6px 0; }
  .footer { font-size: 7.5px; color: #555; text-align: center; margin-top: 6px; }
  .guide p { font-size: 8px; color: #222; line-height: 1.6; margin: 0 0 5px; text-align: justify; }
  .guide b { font-weight: 700; }
  .fee { font-size: 6.5px; color: #555; font-weight: 400; }
  .trunc { font-size: 8px; color: #333; border: 1px dashed #777; padding: 4px 7px; margin: 4px 0 8px; }
</style>
</head>
<body>
  <h1>گزارش تاریخچه بک‌تست — PampDumpCoins</h1>
  <div class="sub">
    حالت: ${meta.mode === 'demo' ? 'دمو (بک‌تست)' : 'واقعی'} • بازه: ${meta.periodLabel} • فیلتر: ${meta.filterLabel}
    • تاریخ گزارش: ${faDateTime(meta.generatedAt)}
  </div>
  <table class="stats">
    <tr>
      <td><span class="k">تعداد معاملات</span><span class="v">${totalTrades.toLocaleString('fa-IR')}</span></td>
      <td><span class="k">سودده / ضررده</span><span class="v">${wins.toLocaleString('fa-IR')} / ${losses.toLocaleString('fa-IR')}</span></td>
      <td><span class="k">نرخ برد</span><span class="v">٪${winRate.toLocaleString('fa-IR')}</span></td>
    </tr>
    <tr>
      <td><span class="k">PNL بسته‌شده (خالص)</span><span class="v ${realized >= 0 ? 'g' : 'r'}">${realized >= 0 ? '+' : '−'}$${usd(realized)}</span></td>
      <td><span class="k">PNL باز (لحظه‌ای)</span><span class="v ${meta.openPnlUsd >= 0 ? 'g' : 'r'}">${meta.openPnlUsd >= 0 ? '+' : '−'}$${usd(meta.openPnlUsd)}</span></td>
      <td><span class="k">سرمایه اولیه</span><span class="v">$${usd(meta.initialCapitalUsd, 0)}</span></td>
    </tr>
    <tr>
      <td><span class="k">موجودی (سرمایه ± PNL بسته‌شده)</span><span class="v ${balance >= meta.initialCapitalUsd ? 'g' : 'r'}">$${usd(balance)}</span></td>
      <td><span class="k">مارجین درگیر (پوزیشن‌های باز)</span><span class="v">$${usd(meta.engagedMarginUsd)}</span></td>
      <td><span class="k">مارجین آزاد</span><span class="v">$${usd(freeMargin)}</span></td>
    </tr>
  </table>
  ${
    !includeTrades
      ? `<div class="empty">این بازه (${meta.periodLabel}) فقط خلاصه‌ی آمار دارد.</div>
    <div class="note">برای سرعتِ ساخت PDF، در بازه‌های بیشتر از ۷ روز جدول ریز معاملات درج نمی‌شود — بازه‌ی «۷ روز» یا «امروز» را انتخاب کنید تا همه‌ی ریز معاملات همان بازه با تمام مشخصات (ورود، استاپ، تیک‌پرافیت، قیمت خروج، حجم مارجین، نوع بسته شدن) در PDF بیاید.</div>`
      : rows.length === 0
        ? '<div class="empty">در این بازه/فیلتر معامله‌ای نیست.</div>'
        : `${meta.truncatedNote ? `<div class="trunc">${meta.truncatedNote}</div>` : ''}${tablesHtml}`
  }
  <div class="footer">PampDumpCoins — گزارش تاریخچه بک‌تست • ${faDateTime(meta.generatedAt)}</div>
  <div class="guide">
    <p><b>راهنمای گزارش:</b> <b>بک‌فیل</b> یعنی ربات بعد از روشن‌شدن/ریست، سیگنال‌های ۷ روز گذشته را تا سقف پوزیشن‌های همزمان به‌عنوان معامله باز کرده (ورود با قیمت و زمان همان سیگنال). <b>استاپ با لوریج:</b> فاصله قیمت استاپ = درصد ضرر ÷ لوریج (حد ضرر ۳٪ با لوریج ۵ = دقیقاً ۱۵٪ ضرر حساب). <b>قیمت خروج</b> قیمت لحظه‌ی بسته شدن است؛ سود دلاری = (خروج − ورود) × جهت × حجم.</p>
    <p><b>نوع بسته شدن:</b> استاپ‌لاس، تیک‌پرافیت، دستی، بستن نهنگ، سیگنال، «برداشت سود» (ربات در ۲۵٪ و ۵۰٪ سود نصف حجم را بست) و «بستن حجمی» (دستیِ شما). <b>تریل استاپ:</b> با ۱٪ حرکت به سود (اسپات)، استاپ ریسک‌فری و بعد روی نصفِ بیشترین سود دنبال می‌شود. <b>حجم مارجین</b> = ارزش پوزیشن ÷ لوریج؛ «مارجین آزاد» = موجودی − مارجین درگیر. <b>PNL بسته‌شده</b> جمع سود/زیان «همه‌ی» معاملات همین بازه/فیلتر است (نه فقط ۱۰۰ ردیف صفحه).</p>
  </div>
</body>
</html>`;
}
