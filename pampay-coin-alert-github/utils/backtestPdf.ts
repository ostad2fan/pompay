/**
 * backtestPdf.ts — v1.5.4
 *
 * «در بک تست بتونم کل تاریخچه را در هر تایم‌فریمی که انتخاب می‌کنم به‌صورت
 * پی‌دی‌اف دانلود کنم یا اشتراک بگذارم و در پی‌دی‌اف تمام مشخصات پوزیشن
 * مثل نام، نقطه ورود، استاپ، تی‌پی، حجم مارجین، نوع بسته شدن (دستی / تیک
 * پروفیت / استاپ / بستن بخش حجم) باشد»
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
}

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

function faNum(n: number, digits = 2): string {
  return n.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function usd(n: number, digits = 2): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** ساخت HTML گزارش PDF تاریخچه بک‌تست (RTL فارسی، سبک فیوچرز بایننس). */
export function buildBacktestPdfHtml(rows: BacktestPdfRow[], meta: BacktestPdfMeta): string {
  const totalTrades = rows.length;
  const wins = rows.filter((r) => (r.realizedPnl ?? 0) >= 0).length;
  const losses = totalTrades - wins;
  const realized = rows.reduce((s, r) => s + (r.realizedPnl ?? 0), 0);
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const balance = meta.initialCapitalUsd + realized;
  const freeMargin = Math.max(0, balance - meta.engagedMarginUsd);

  const rowsHtml = rows
    .map((r, i) => {
      const pnl = r.realizedPnl ?? 0;
      const pnlColor = pnl >= 0 ? '#0ecb81' : '#f6465d';
      const sideColor = r.side === 'long' ? '#0ecb81' : '#f6465d';
      const reason = PERSIAN_CLOSE_REASON[r.closeReason ?? ''] ?? (r.closeReason ? r.closeReason : '—');
      return `
      <tr>
        <td class="c">${(i + 1).toLocaleString('fa-IR')}</td>
        <td class="c b">${r.symbol}</td>
        <td class="c" style="color:${sideColor}">${r.side === 'long' ? 'لانگ 🟢' : 'شورت 🔴'} ×${r.leverage.toLocaleString('fa-IR')}</td>
        <td class="c">${r.strategyName ?? '—'}</td>
        <td class="c">${r.sourceLabel ?? '—'}</td>
        <td class="c mono">${r.entryText}</td>
        <td class="c mono">${r.stopText}</td>
        <td class="c mono">${r.takeText}</td>
        <td class="c mono">$${usd(r.marginUsd)}</td>
        <td class="c">${faDateTime(r.openedAt)}</td>
        <td class="c">${faDateTime(r.closedAt)}</td>
        <td class="c">${reason}</td>
        <td class="c mono b" style="color:${pnlColor}">${pnl >= 0 ? '+' : '−'}$${usd(pnl)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Tahoma', 'Segoe UI', sans-serif; background: #0b0e11; color: #eaecef; margin: 0; padding: 24px; }
  .card { background: #181a20; border: 1px solid #2b3139; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #f0b90b; }
  .sub { font-size: 11px; color: #848e9c; margin-bottom: 12px; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .stat { flex: 1 1 30%; min-width: 150px; background: #0b0e11; border: 1px solid #2b3139; border-radius: 10px; padding: 10px 12px; margin: 3px; }
  .stat .k { font-size: 10px; color: #848e9c; margin-bottom: 4px; }
  .stat .v { font-size: 14px; font-weight: 700; direction: ltr; text-align: right; }
  .green { color: #0ecb81; } .red { color: #f6465d; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  th { background: #0b0e11; color: #f0b90b; padding: 7px 4px; border: 1px solid #2b3139; font-size: 9px; white-space: nowrap; }
  td { padding: 6px 4px; border: 1px solid #232830; vertical-align: middle; }
  .c { text-align: center; } .b { font-weight: 700; }
  .mono { font-family: 'Courier New', monospace; direction: ltr; text-align: center; }
  .empty { text-align: center; color: #848e9c; padding: 18px; }
  .footer { font-size: 9px; color: #707a8a; text-align: center; margin-top: 10px; }
  /* v1.5.7 — R6: راهنمای زیر جدول */
  .guide h2 { font-size: 13px; color: #f0b90b; margin: 0 0 8px; }
  .guide p { font-size: 9.5px; color: #9aa0aa; line-height: 1.75; margin: 0 0 7px; text-align: justify; }
  .guide p strong { color: #eaecef; }
</style>
</head>
<body>
  <div class="card">
    <h1>🤖 گزارش تاریخچه بک‌تست — PampDumpCoins</h1>
    <div class="sub">
      حالت: ${meta.mode === 'demo' ? 'دمو (بک‌تست)' : 'واقعی'} • بازه: ${meta.periodLabel} • فیلتر: ${meta.filterLabel}
      • تاریخ گزارش: ${faDateTime(meta.generatedAt)}
    </div>
    <div class="grid">
      <div class="stat"><div class="k">تعداد معاملات</div><div class="v">${totalTrades.toLocaleString('fa-IR')}</div></div>
      <div class="stat"><div class="k">سودده / ضررده</div><div class="v">${wins.toLocaleString('fa-IR')} / ${losses.toLocaleString('fa-IR')}</div></div>
      <div class="stat"><div class="k">نرخ برد</div><div class="v">٪${winRate.toLocaleString('fa-IR')}</div></div>
      <div class="stat"><div class="k">PNL بسته‌شده (خالص)</div><div class="v ${realized >= 0 ? 'green' : 'red'}">${realized >= 0 ? '+' : '−'}$${usd(realized)}</div></div>
      <div class="stat"><div class="k">PNL باز (لحظه‌ای)</div><div class="v ${meta.openPnlUsd >= 0 ? 'green' : 'red'}">${meta.openPnlUsd >= 0 ? '+' : '−'}$${usd(meta.openPnlUsd)}</div></div>
      <div class="stat"><div class="k">سرمایه اولیه</div><div class="v">$${usd(meta.initialCapitalUsd, 0)}</div></div>
      <div class="stat"><div class="k">موجودی (سرمایه ± PNL بسته‌شده)</div><div class="v ${balance >= meta.initialCapitalUsd ? 'green' : 'red'}">$${usd(balance)}</div></div>
      <div class="stat"><div class="k">مارجین درگیر (پوزیشن‌های باز)</div><div class="v">$${usd(meta.engagedMarginUsd)}</div></div>
      <div class="stat"><div class="k">مارجین آزاد</div><div class="v">$${usd(freeMargin)}</div></div>
    </div>
  </div>
  <div class="card">
    ${
      rows.length === 0
        ? '<div class="empty">در این بازه/فیلتر معامله‌ای نیست.</div>'
        : `<table>
      <thead>
        <tr>
          <th>#</th><th>ارز</th><th>جهت / لوریج</th><th>استراتژی</th><th>اندیکاتور/منبع</th>
          <th>نقطه ورود</th><th>استاپ</th><th>تیک‌پرافیت</th><th>حجم مارجین</th>
          <th>باز شد</th><th>بسته شد</th><th>نوع بسته شدن</th><th>سود/زیان</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`
    }
    <div class="footer">PampDumpCoins — گزارش تاریخچه بک‌تست • ${faNum(meta.engagedMarginUsd)}$ مارجین درگیر لحظه‌ی ساخت گزارش</div>
  </div>
  <div class="card guide">
    <h2>📖 راهنمای گزارش (توضیح ستون‌ها و اصطلاح‌ها)</h2>
    <p><strong>بک‌فیل (Backfill):</strong> وقتی ربات برای اولین بار روشن می‌شود یا بعد از «ریست کامل»، سیگنال‌های ۷ روز گذشته را دوباره (تا سقف پوزیشن‌های همزمان باز) به‌عنوان معامله باز می‌کند تا تاریخچه‌ای برای تحلیل داشته باشد. معاملاتی که منبعشان بک‌فیل است، همان منطق استاپ/تیک‌پرافیت را طی می‌کنند و مثل بقیه مدیریت می‌شوند.</p>
    <p><strong>استاپ با لوریج (SL):</strong> حد ضرر بر اساس «ضرر حساب» است؛ فاصله قیمت = درصد ضرر ÷ لوریج. مثال: حد ضرر ۳٪ با لوریج ۵ یعنی قیمت فقط ۰.۶٪ خلاف جهت برود، استاپ می‌خورد و حساب دقیقاً ۳٪ (مارجین همان معامله) ضرر می‌کند. ستون «استاپ» قیمت استاپ‌لاس و «تیک‌پرافیت» قیمت هدف (حد ضرر × ریوارد) است.</p>
    <p><strong>نوع بسته شدن:</strong> استاپ‌لاس (رسیدن به حد ضرر)، تیک‌پرافیت (رسیدن به هدف)، دستی (بستن توسط خودتان)، بستن نهنگ (نهنگِ کپی‌شده پوزیشنش را بست)، سیگنال، «برداشت سود» (ربات در ۲۵٪ و ۵۰٪ سود، خودش بخشی از حجم را بست) و «بستن حجمی» (✂ دستیِ شما روی بخشی از حجم).</p>
    <p><strong>تریل استاپ:</strong> وقتی معامله ۱٪ به سود برود (قیمت اسپات)، استاپ روی نقطه ورود + کارمزد می‌رود (ریسک‌فری) و بعد روی «نصفِ بیشترین سود» دنبال می‌شود تا معامله سودده با ضرر بسته نشود.</p>
    <p><strong>حجم مارجین:</strong> ارزش دلاریِ پوزیشن ÷ لوریج = مبلغی از حساب که این معامله قفل کرده است. «مارجین درگیر» مجموع این مبلغ برای پوزیشن‌های بازِ لحظه‌ی ساخت گزارش است و «مارجین آزاد» = موجودی − مارجین درگیر.</p>
    <p><strong>PNL بسته‌شده (خالص):</strong> مجموع سود/زیان «تمام» معاملات همین بازه/فیلتر — نه فقط ۱۰۰ ردیف روی صفحه؛ این گزارش PDF همه‌ی معاملات بازه را شامل می‌شود. «PNL باز» سود/زیان لحظه‌ای پوزیشن‌های هنوز باز است و در آن جمع نمی‌شود.</p>
    <p><strong>اندیکاتور/منبع:</strong> نشان می‌دهد معامله از کدام سیگنال باز شده: نهنگِ کپی‌شده (Hyperliquid)، هوک ریورسال، GainzAlgo، اندیکاتور دستی شما، یا بک‌فیل.</p>
    <p><strong>نکته کارمزد:</strong> در حالت دمو، ارزش‌گذاری تقریبی است و کارمزد دقیق صرافی شما (تیکر/میکر) لحظه‌به‌لحظه کم نمی‌شود؛ در حالت واقعی، کارمزد واقعی صرافی به PnL اعمال می‌شود. برای بررسی اینکه با کارمزد صرافی شما این تنظیمات می‌صرفد یا نه، از «محاسبه‌گر بک‌تست واقعی» در تب بک‌تست استفاده کنید.</p>
  </div>
</body>
</html>`;
}
