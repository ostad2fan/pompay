#!/usr/bin/env node
/**
 * scripts/test-v1511.cjs — smoke test نسخه ۱.۵.۱۱
 *
 *  A) merge «بسته‌شدن، قطعی است» (utils/autoMerge.ts):
 *     1. بسته‌محلی vs بازِ سرور → بسته می‌ماند (ریشه‌ی الارم تکراری)
 *     2. بازِ محلی vs بسته‌سرور → بسته‌ی سرور برنده
 *     3. دو بسته → جدیدترین closedAt
 *     4. دو باز → سرور برنده (رفتار قبلی حفظ شد)
 *     5. آرایه خالی سرور → محلی دست‌نخورده
 *     6. رکورد فقط‌محلی و فقط‌سرور حفظ/اضافه می‌شوند
 *
 *  B) PDF «چاپ سریع» (utils/backtestPdf.ts):
 *     7. ۷ روز با ۴۰۰ و ۲۰۰۰ ردیف → جدول کامل ۱۴ ستونی + قیمت خروج
 *     8. جدول تکه‌تکه: تعداد <table class="t"> = ceil(n/40)
 *     9. بدون بک‌گراند تیره؛ پس‌زمینه سفید؛ بدون ایموجی
 *    10. ۳۰ روز / همه → فقط خلاصه (بدون جدول ریز)
 *    11. نبودِ exitText → «—»
 *    12. سرعت: ۲۰۰۰ ردیف < ۱۰۰ms
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v1511-'));

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
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}

// ---------------------------------------------------------------------------
console.log('A) merge «بسته‌شدن، قطعی است»:');
const now = Date.now();

// 1) بسته‌محلی vs بازِ سرور → بسته می‌ماند
{
  const local = [{ id: 'p1', symbol: 'BTC', status: 'closed', closedAt: now, realizedPnl: 5 }];
  const server = [{ id: 'p1', symbol: 'BTC', status: 'open', lastPrice: 100 }];
  const out = mergePositionsById(local, server);
  check('۱. بسته‌محلی با بازِ سرور بازنویسی نمی‌شود', out.length === 1 && out[0].status === 'closed' && out[0].realizedPnl === 5);
}
// 2) بازِ محلی vs بسته‌سرور → بسته‌ی سرور
{
  const local = [{ id: 'p2', symbol: 'ETH', status: 'open' }];
  const server = [{ id: 'p2', symbol: 'ETH', status: 'closed', closedAt: now, realizedPnl: -2 }];
  const out = mergePositionsById(local, server);
  check('۲. بسته‌ی سرور روی بازِ محلی می‌نشیند', out.length === 1 && out[0].status === 'closed' && out[0].realizedPnl === -2);
}
// 3) دو بسته → جدیدترین closedAt
{
  const local = [{ id: 'p3', status: 'closed', closedAt: now, realizedPnl: 1 }];
  const server = [{ id: 'p3', status: 'closed', closedAt: now - 60_000, realizedPnl: 2 }];
  const out = mergePositionsById(local, server);
  check('۳. دو بسته → جدیدترین closedAt برنده (محلی)', out[0].realizedPnl === 1);
  const out2 = mergePositionsById(
    [{ id: 'p3', status: 'closed', closedAt: now - 60_000, realizedPnl: 1 }],
    [{ id: 'p3', status: 'closed', closedAt: now, realizedPnl: 2 }]
  );
  check('۳ب. دو بسته → جدیدترین closedAt برنده (سرور)', out2[0].realizedPnl === 2);
}
// 4) دو باز → سرور برنده
{
  const out = mergePositionsById(
    [{ id: 'p4', status: 'open', lastPrice: 10 }],
    [{ id: 'p4', status: 'open', lastPrice: 20 }]
  );
  check('۴. دو باز → سرور برنده (رفتار قبلی)', out[0].lastPrice === 20);
}
// 5) آرایه خالی سرور
{
  const local = [{ id: 'p5', status: 'open' }, { id: 'p6', status: 'closed', closedAt: now }];
  const out = mergePositionsById(local, []);
  check('۵. سرور خالی → محلی دست‌نخورده', out.length === 2);
}
// 6) ترکیب فقط‌محلی + فقط‌سرور
{
  const out = mergePositionsById(
    [{ id: 'a', status: 'closed', closedAt: now }],
    [{ id: 'b', status: 'open' }]
  );
  check('۶. رکورد فقط‌محلی + فقط‌سرور هر دو حفظ می‌شوند', out.length === 2 && out.some((p) => p.id === 'a') && out.some((p) => p.id === 'b'));
}

// ---------------------------------------------------------------------------
function makeRows(n, withExit = true) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      symbol: ['BTC', 'ETH', 'SOL', 'BCH', 'XRP'][i % 5],
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
  periodLabel: '۷ روز',
  filterLabel: 'همه',
  initialCapitalUsd: 1000,
  engagedMarginUsd: 120,
  openPnlUsd: 3.5,
  generatedAt: 1730000000000,
};

console.log('B) PDF «چاپ سریع»:');
// 7+8) ۴۰۰ ردیف هفت‌روزه
{
  const rows = makeRows(400);
  const html = buildBacktestPdfHtml(rows, { ...metaBase, windowDays: 7 });
  const tables = (html.match(/<table class="t">/g) || []).length;
  check('۷. ۴۰۰ ردیف ۷روزه → جدول کامل (قیمت خروج درج)', html.includes('50100.00') && html.includes('قیمت خروج'));
  check(`۸. جدول تکه‌تکه: ${tables} تکه = ceil(400/40)=10`, tables === Math.ceil(400 / PDF_TABLE_CHUNK) && tables === 10);
}
// 9) بدون بک‌گراند تیره + بدون ایموجی
{
  const html = buildBacktestPdfHtml(makeRows(20), { ...metaBase, windowDays: 7 });
  check('۹الف. بدون بک‌گراند تیره (سفید)', !html.includes('#0b0e11') && !html.includes('#181a20') && html.includes('background: #fff'));
  check('۹ب. بدون ایموجی در سند', !/\p{Extended_Pictographic}/u.test(html.replace(/[\u0600-\u06FF\u200c\s]/g, '') || ''));
}
// 10) ۳۰ روز / همه → فقط خلاصه
{
  const h30 = buildBacktestPdfHtml(makeRows(500), { ...metaBase, windowDays: 30 });
  const hAll = buildBacktestPdfHtml(makeRows(500), { ...metaBase, windowDays: Infinity });
  check('۱۰. ۳۰ روز و «همه» → فقط خلاصه', !h30.includes('<table class="t">') && !hAll.includes('<table class="t">') && h30.includes('فقط خلاصه'));
}
// 11) نبود exitText → «—»
{
  const html = buildBacktestPdfHtml(makeRows(3, false), { ...metaBase, windowDays: 7 });
  check('۱۱. نبود قیمت خروج → «—»', html.includes('—'));
}
// 12) سرعت ۲۰۰۰ ردیف
{
  const rows = makeRows(2000);
  const t0 = Date.now();
  const html = buildBacktestPdfHtml(rows, { ...metaBase, windowDays: 7 });
  const dt = Date.now() - t0;
  const tables = (html.match(/<table class="t">/g) || []).length;
  check(`۱۲. ۲۰۰۰ ردیف در ${dt}ms (< 100ms) و ${tables} تکه = 50`, dt < 100 && tables === 50);
}

console.log(`\nنتیجه: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
