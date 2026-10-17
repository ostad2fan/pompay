# GITHUB UPDATE — v1.5.2 (versionCode 27)

## مراحل آپلود (کاربر)

۱. مخزن `ostad2fan/pompay` را باز کنید و پوشه `pampay-coin-alert-github` را با فایل‌های این بسته به‌روز کنید (فایل‌های تغییر کرده را جایگزین کنید؛ بقیه دست نخورده‌اند).

۲. حتماً این فایل‌ها را آپلود کنید:
- `apk/version.json` (نسخه ۱.۵.۲/۲۷)
- `apk/PampDumpCoins-v1.5.2.apk` (همان APK امضاشده این بسته)
- `app.json` + `utils/appUpdate.ts`
- `app/(tabs)/trade-ai/_layout.tsx` + `index.tsx` + `real-trade.tsx` + **`auto-trade.tsx` (فایل جدید — تب «بک‌تست»)** ← در ۱.۵.۱ گفته بودیم auto-trade.tsx را حذف کنید؛ حالا **دوباره اضافه کنید** (این بار نسخه جدیدِ تب بک‌تست است)
- `app/(tabs)/settings/index.tsx` (راهنمای به‌روزشده)
- `components/AutoTradingBotSection.tsx` + `components/TradeAiSegmentHeader.tsx`
- `utils/autoTradingEngine.ts` + `utils/foreignExchangeBalances.ts` (فیکس LBank)
- **`server/src/backtestEngine.ts` (فایل جدید — موتور بک‌تست ۲۴/۷ سرور)**
- **`server/src/index.ts` (اندپوینت‌های /autotrade/config و /autotrade/state + استارت موتور)**
- `CHANGES-1.5.2.md`

۳. بعد از آپلود این آدرس را چک کنید که 1.5.2 نشان بدهد:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```

۴. **Railway حتماً ری‌دیپلوی کنید** — این نسخه فایل‌های سرور دارد:
- `server/src/backtestEngine.ts` (جدید): موتور بک‌تست ۲۴/۷ — اعلام تلگرام باز/بسته شدن پوزیشن‌های دمو و واقعی حتی وقتی برنامه بسته است.
- `server/src/index.ts`: اندپوینت‌های جدید + استارت موتور در بوت.
- بدون ری‌دیپلوی، سوییچ «اعلام تلگرام ۲۴/۷ (سرور)» کار نمی‌کند و ربات فقط روی خود گوشی می‌چرخد (بقیه امکانات سالم است).

## نکته‌ها
- وابستگی جدیدی ندارد (همان بسته ۱.۵.۰/۱.۵.۱) — نصب روی نسخه قبلی بدون حذف برنامه.
- امضای APK با همه نسخه‌های قبل یکسان است — آپدیت مستقیم.
- آپدیت درون‌برنامه‌ای: jsdelivr → raw → رله Railway (مثل قبل).
- LBank: کلیدهای API شما بدون تغییر کار می‌کنند (فقط دامنه و امضای درخواست عوض شد).
