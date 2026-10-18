# GITHUB UPDATE — v1.5.3 (versionCode 28)

## مراحل آپلود (کاربر)

۱. مخزن `ostad2fan/pompay` را باز کنید و پوشه `pampay-coin-alert-github` را با فایل‌های این بسته به‌روز کنید (فایل‌های تغییر کرده را جایگزین کنید؛ بقیه دست نخورده‌اند).

۲. حتماً این فایل‌ها را آپلود کنید:
- `apk/version.json` (نسخه ۱.۵.۳/۲۸)
- `apk/PampDumpCoins-v1.5.3.apk` (همان APK امضاشده این بسته)
- `app.json` + `utils/appUpdate.ts`
- `app/(tabs)/trade-ai/auto-trade.tsx` (پر کردن خودکار جدول با استراتژی)
- `app/(tabs)/settings/index.tsx` (راهنمای به‌روزشده v1.5.3)
- `app/(tabs)/whales/index.tsx` + `app/(tabs)/whales/wallet-detail.tsx` (PnL نهنگ در صفحه جزئیات)
- `components/AutoTradingBotSection.tsx` (ریست، نصف‌بستن، ساعت/تاریخ ورود، موجودی، ذخیره)
- `utils/autoTradingEngine.ts` (حد ضرر با لوریج، تریل جدید، پارشیال، ریست، تلگرام)
- `utils/binanceFuturesTrading.ts` (closePartialPosition)
- `utils/foreignExchangeBalances.ts` (قیمت LBank از خود LBank)
- `assets/images/splash-icon.png` + `assets/images/adaptive-icon.png` (حاشیه مشکی) + `assets/images/icon-dark.png` (جدید)
- **`server/src/backtestEngine.ts` (موتور ۲۴/۷ نسخه جدید — حتماً)**
- `CHANGES-1.5.3.md`

۳. بعد از آپلود این آدرس را چک کنید که 1.5.3 نشان بدهد:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```

۴. **Railway حتماً ری‌دیپلوی کنید** — `server/src/backtestEngine.ts` نسخه جدید دارد:
- حد ضرر با لوریج + تریل جدید + برداشت سود پله‌ای ۲۵٪/۵۰٪ (دمو و واقعی).
- اعلام شروع/ری‌استارت به تلگرام + حذف لاگ «متوقف شد» در ری‌استارت.
- پرچم `reset:true` برای ریست کامل از داخل برنامه.
- بدون ری‌دیپلوی: اعلام‌های ۲۴/۷ با برنامه بسته نمی‌آید (وقتی برنامه باز است، خود برنامه اعلان می‌فرستد) و خطای «سرور موتور بک‌تست ندارد» در وضعیت سرور دیده می‌شود.

## نکته‌ها
- وابستگی جدیدی ندارد — نصب روی ۱.۵.۲ بدون حذف برنامه (امضای APK یکسان).
- تنظیمات و پوزیشن‌های قبلی حفظ می‌شوند؛ پوزیشن‌های بازِ قدیمی با قوانین تریل جدید مدیریت می‌شوند.
- برای دیدن اعلان شروع در تلگرام، یک بار ربات را خاموش/روشن کنید.
