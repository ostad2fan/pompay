#!/usr/bin/env node
/**
 * scripts/test-v1512.cjs — smoke test نسخه ۱.۵.۱۲
 *
 *  A) PDF (utils/backtestPdf.ts):
 *     1. ۷ روز با ۱۰۰۰+ ردیف → جدول کامل ۱۴ ستونی
 *     2. fullStats: آمار کارت از «کلِ» بازه حتی وقتی جدول بریده شده
 *     3. truncatedNote در HTML وقتی بریده شده؛ نبودش وقتی بریده نشده
 *     4. feesText → خط «کارمزد/فاندینگ» با کلاس .fee زیر سود/زیان
 *     5. ۳۰ روز/همه → فقط خلاصه (بدون جدول)
 *     6. بدون استایل درون‌خطی / بدون بک‌گراند تیره
 *     7. سرعت: ۲۰۰۰ ردیف < ۱۰۰ms
 *
 *  B) merge (utils/autoMerge.ts) — بسته‌شدن قطعی است + فیلد جدید جابه‌جا می‌شود:
 *     8. بسته‌محلی vs بازِ سرور → بسته می‌ماند
 *     9. پوزیشن باز سرور با partialRealizedPnl → فیلد حفظ می‌شود (merge کل-آبجکت)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v1512-'));

execSync(
  `npx tsc "${path.join(ROOT, 'utils/backtestPdf.ts')}" "${path.join(ROOT, 'utils/autoMerge.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --skipLibCheck`,
  { stdio: 'inherit', cwd: ROOT }
);
const { buildBacktestPdfHtml, PDF_TABLE_CHUNK } = require(path.join(TMP, 'backtestPdf.js'));
const { mergePositionsById } = require(path.join(TMP, 'autoMerge.js'));

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  \u2705 ${name}`);
  } else {
    fail++;
    console.log(`  \u274c ${name}`);
  }
}

function mkRow(i, pnl, feesText) {
  const base = 45000 + i;
  return {
    symbol: 'BTC',
    side: i % 2 === 0 ? 'long' : 'short',
    strategyName: 'متعادل',
    sourceLabel: 'اندیکاتور RSI',
    entryPrice: base,
    stopPrice: base * 0.97,
    takePrice: base * 1.06,
    marginUsd: 100,
    qty: 0.01,
    leverage: 5,
    openedAt: 1760000000000 + i * 60_000,
    closedAt: 1760000000000 + i * 60_000 + 3_600_000,
    closeReason: i % 3 === 0 ? 'stop' : i % 3 === 1 ? 'take' : 'partial',
    realizedPnl: pnl,
    entryText: String(base),
    stopText: String(base * 0.97),
    takeText: String(base * 1.06),
    exitText: String(base * 1.01),
    feesText,
  };
}

console.log('A) PDF v1.5.12:');
// 1000 trades across 7 days, mixed PnL
const N = 1000;
const rows = [];
for (let i = 0; i < N; i++) rows.push(mkRow(i, i % 2 === 0 ? 12.5 : -8.25, i % 2 === 0 ? 'فاندینگ −$0.35 • کارمزد −$0.12' : undefined));
const fullWins = rows.filter((r) => r.realizedPnl >= 0).length;
const fullRealized = rows.reduce((s, r) => s + r.realizedPnl, 0);

const meta = {
  mode: 'real',
  periodLabel: '۷ روز',
  filterLabel: 'همه',
  initialCapitalUsd: 1000,
  engagedMarginUsd: 300,
  openPnlUsd: 25,
  generatedAt: 1760100000000,
  windowDays: 7,
  fullStats: { trades: N, wins: fullWins, losses: N - fullWins, realized: fullRealized },
  truncatedNote: `از ${N.toLocaleString('fa-IR')} معامله‌ی این بازه، ۸۰۰ معامله‌ی آخر در جدول آمده`,
};

// slice like the UI does (800 newest)
const cappedRows = rows.slice(0, 800).map((r, i) => ({ ...r, feesText: i % 2 === 0 ? r.feesText : undefined }));
const html = buildBacktestPdfHtml(cappedRows, meta);

check('1. جدول کامل ۱۴ ستونی (سربرگ ارز+قیمت خروج)', html.includes('قیمت خروج') && html.includes('حجم مارجین'));
check('1b. جدول تکه‌تکه: ceil(800/40) جدول', (html.match(/<table class="t">/g) || []).length === Math.ceil(800 / PDF_TABLE_CHUNK));
check('2. fullStats: تعداد کل ۱۰۰۰ در کارت آمار', html.includes('۱٬۰۰۰'));
check('2b. fullStats: سود خالص کل در کارت', html.includes(new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fullRealized).replace(/,/g, ',')));
check('3. truncatedNote در HTML آمده', html.includes('۸۰۰ معامله\u200cی آخر در جدول آمده'));
check('3b. بدون truncatedNote → بدون کلاس trunc', !buildBacktestPdfHtml(rows.slice(0, 10), { ...meta, truncatedNote: undefined, fullStats: undefined }).includes('class="trunc"'));
check('4. feesText با کلاس .fee زیر سود/زیان', html.includes('class="fee"') && html.includes('فاندینگ'));
check('5. ۳۰ روز → فقط خلاصه (بدون جدول ریز)', !(buildBacktestPdfHtml(rows.slice(0, 10), { ...meta, windowDays: 30, truncatedNote: undefined }).includes('<table class="t">')));
check('6. بدون استایل درون‌خطی', !html.includes('style="'));
check('6b. پس‌زمینه سفید', html.includes('background: #fff'));
{
  const big = [];
  for (let i = 0; i < 2000; i++) big.push(mkRow(i, 5, undefined));
  const t0 = Date.now();
  buildBacktestPdfHtml(big, { ...meta, truncatedNote: undefined });
  const ms = Date.now() - t0;
  check(`7. سرعت ۲۰۰۰ ردیف = ${ms}ms (< ۱۰۰)`, ms < 100);
}

console.log('B) merge v1.5.12:');
const local = [{ id: 'a', status: 'closed', closedAt: 100, partialRealizedPnl: 9.5 }];
const server = [{ id: 'a', status: 'open', closedAt: undefined, partialRealizedPnl: 0 }];
const m1 = mergePositionsById(local, server);
check('8. بسته‌ی محلی بر بازِ سرور برنده است', m1[0].status === 'closed');
const srvOpen = [{ id: 'b', status: 'open', partialRealizedPnl: 4.25 }];
const m2 = mergePositionsById([], srvOpen);
check('9. partialRealizedPnl در merge حفظ می‌شود', m2[0].partialRealizedPnl === 4.25);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
