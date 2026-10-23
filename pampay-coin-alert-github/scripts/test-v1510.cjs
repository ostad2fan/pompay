#!/usr/bin/env node
/**
 * scripts/test-v1510.cjs — smoke test برای سیاست PDF نسخه ۱.۵.۱۰
 *
 * «PDF مثل عکسِ قبلی با همه جزئیات، هم تایم‌فریم امروز هم ۷ روزه»:
 *   1. امروز (windowDays=1) با هر تعداد ردیف → جدول کامل ۱۴ ستونی
 *      (شامل استاپ/تیک‌پرافیت/استراتژی/اندیکاتور/قیمت خروج) — بدون جدول فشرده.
 *   2. ۷ روز (windowDays=7) → همان جدول کامل، حتی ۴۰۰ ردیف.
 *   3. ۳۰ روز / همه → فقط خلاصه (بدون جدول ریز).
 *   4. «قیمت خروج» درج می‌شود؛ نبودش «—».
 *   5. سرعت: ۲۰۰۰ ردیف < ۱۰۰ms.
 *   6. بدون استایل درون‌خطی در سلول‌ها (کلاس CSS — سرعت expo-print).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v1510-pdf-'));

// transpile the pure module (no imports) to CommonJS
execSync(
  `npx tsc "${path.join(ROOT, 'utils/backtestPdf.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --skipLibCheck`,
  { stdio: 'inherit', cwd: ROOT }
);
const { buildBacktestPdfHtml } = require(path.join(TMP, 'backtestPdf.js'));

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}

function makeRows(n, withExit = true) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      symbol: 'BTCUSDT' === '' ? 'X' : ['BTC', 'ETH', 'SOL', 'BCH', 'XRP'][i % 5],
      side: i % 2 === 0 ? 'long' : 'short',
      strategyName: 'اسکالپر',
      sourceLabel: 'هوک ریورسال',
      entryPrice: 50000 + i,
      stopPrice: 49000 + i,
      takePrice: 52000 + i,
      marginUsd: 50,
      qty: 0.001,
      leverage: 5,
      openedAt: 1730000000000 + i * 60000,
      closedAt: 1730003600000 + i * 60000,
      closeReason: i % 3 === 0 ? 'stop' : i % 3 === 1 ? 'take' : 'manual',
      realizedPnl: (i % 3 === 1 ? 1 : -1) * (2 + (i % 5)),
      entryText: (50000 + i).toFixed(2),
      stopText: (49000 + i).toFixed(2),
      takeText: (52000 + i).toFixed(2),
      ...(withExit ? { exitText: (50100 + i).toFixed(2) } : {}),
    });
  }
  return rows;
}

const metaBase = {
  mode: 'demo',
  periodLabel: 'امروز',
  filterLabel: 'همه',
  initialCapitalUsd: 1000,
  engagedMarginUsd: 120,
  openPnlUsd: 3.5,
  generatedAt: 1730000000000,
};

console.log('1) امروز — ۳ ردیف، جدول کامل با همه ستون‌ها:');
{
  const html = buildBacktestPdfHtml(makeRows(3), { ...metaBase, windowDays: 1 });
  check('جدول درج شده', html.includes('<table>'));
  check('ستون «قیمت خروج» در سربرگ', html.includes('<th>قیمت خروج</th>'));
  check('ستون استاپ + تیک‌پرافیت + استراتژی + اندیکاتور', html.includes('<th>استاپ</th>') && html.includes('<th>تیک‌پرافیت</th>') && html.includes('<th>استراتژی</th>') && html.includes('<th>اندیکاتور/منبع</th>'));
  check('ستون‌های زمان باز/بسته + نوع بسته شدن + سود/زیان', html.includes('<th>باز شد</th>') && html.includes('<th>بسته شد</th>') && html.includes('<th>نوع بسته شدن</th>') && html.includes('<th>سود/زیان</th>'));
  const trCount = (html.match(/<tr>/g) || []).length;
  check(`همه‌ی ۳ ردیف + سربرگ درج شده (got ${trCount})`, trCount === 4);
  check('قیمت خروجِ ردیف اول درج شده', html.includes('50100.00'));
}

console.log('2) ۷ روز — ۴۰۰ ردیف، همچنان جدول کامل (بدون حالت فشرده):');
{
  const html = buildBacktestPdfHtml(makeRows(400), { ...metaBase, periodLabel: '۷ روز', windowDays: 7 });
  const trCount = (html.match(/<tr>/g) || []).length;
  check(`همه‌ی ۴۰۰ ردیف + سربرگ (got ${trCount})`, trCount === 401);
  check('سربرگ کامل ۱۴ ستونی', html.includes('<th>قیمت خروج</th>') && html.includes('<th>نقطه ورود</th>'));
  check('بدون یادداشت «ستون‌های فشرده»', !html.includes('ستون‌های فشرده'));
  const rowSample = html.split('<tbody>')[1].split('</tr>')[0];
  const tdCount = (rowSample.match(/<td/g) || []).length;
  check(`هر ردیف ۱۴ سلول دارد (got ${tdCount})`, tdCount === 14);
}

console.log('3) ۳۰ روز / همه — فقط خلاصه:');
{
  const h30 = buildBacktestPdfHtml(makeRows(50), { ...metaBase, periodLabel: '۳۰ روز', windowDays: 30 });
  check('۳۰ روز: بدون جدول ریز', !h30.includes('<table>'));
  check('۳۰ روز: پیام خلاصه دارد', h30.includes('فقط خلاصه'));
  const hAll = buildBacktestPdfHtml(makeRows(50), { ...metaBase, periodLabel: 'همه', windowDays: Infinity });
  check('همه: بدون جدول ریز', !hAll.includes('<table>'));
  check('همه: راهنمای انتخاب ۷ روز دارد', hAll.includes('۷ روز'));
}

console.log('4) قیمت خروج — نبودش «—»:');
{
  const html = buildBacktestPdfHtml(makeRows(2, false), { ...metaBase, windowDays: 1 });
  const row = html.split('<tbody>')[1].split('</tr>')[0];
  check('بدون exitText → «—» در ستون خروج', /class="mono">—<\/td>/.test(row));
}

console.log('5) سرعت — ۲۰۰۰ ردیف:');
{
  const rows = makeRows(2000);
  const t0 = Date.now();
  buildBacktestPdfHtml(rows, { ...metaBase, periodLabel: '۷ روز', windowDays: 7 });
  const ms = Date.now() - t0;
  check(`ساخت HTML در ${ms}ms (< ۱۰۰ms)`, ms < 100);
  const t1 = Date.now();
  buildBacktestPdfHtml(rows, { ...metaBase, periodLabel: '۷ روز', windowDays: 7 });
  check('اجرای دوم هم سریع', Date.now() - t1 < 150);
}

console.log('6) بدون استایل درون‌خطی:');
{
  const html = buildBacktestPdfHtml(makeRows(300), { ...metaBase, windowDays: 7 });
  const tbody = html.split('<tbody>')[1].split('</tbody>')[0];
  check('هیچ style= درون سلول‌ها نیست', !tbody.includes('style='));
}

console.log('');
console.log(fail === 0 ? `✅ ALL ${pass} PASS` : `❌ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
