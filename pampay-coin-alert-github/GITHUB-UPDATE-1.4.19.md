# راهنمای آپدیت گیت‌هاب — نسخه ۱.۴.۱۹ (versionCode 24)

## فایل‌های جدید
- `utils/tokenRegistry.ts` — رجیستری ثابت ۲٬۵۰۰+ توکن / ۲۹ شبکه (۲۴۶KB)
- `utils/autoTradingEngine.ts` — موتور معامله‌گر خودکار
- `components/AutoTradingBotSection.tsx` — UI معامله‌گر خودکار

## فایل‌های ویرایش‌شده
- `utils/blockchainWallets.ts` — آدرس اختصاصی هر شبکه + ۶ توکن ترون (از ۱.۴.۱۸)
- `utils/blockchainWalletApi.ts` — رجیستری ثابت + آدرس per-network + رفرش اجباری قیمت تازه + اصلاح آدرس فلوکی
- `components/BlockchainWalletsSection.tsx` — فرم آدرس هر شبکه + PnL کل فقط کیف‌ها + اسپینر/اعلان رفرش
- `components/LocalAssetsSection.tsx` — حذف دو ردیف تکراری
- `app/(tabs)/wallet/index.tsx` — رفرش مستقیم + refetch بعد از افزودن/ویرایش + قیمت اختصاصی بیت‌پرپ
- `app/(tabs)/whales/index.tsx` — چیپ‌های PnL نهنگ (۷/۳۰/۹۰/۱۸۰ + باز)
- `app/(tabs)/trade-ai/real-trade.tsx` — بخش معامله‌گر خودکار
- `utils/hyperliquidApi.ts` — fetchWhalePnl
- `app.json` `apk/version.json` `utils/appUpdate.ts` → ۱.۴.۱۹ / 24

## مراحل
1. محتوای `pompay-github-v1.4.19-update.zip` را در `pampay-coin-alert-github/` جایگزین کنید.
2. APK قدیمی را از `apk/` حذف و `PampDumpCoins-v1.4.19.apk` را بگذارید.
3. کامیت و پوش — سرور تغییر نکرده (Redeploy لازم نیست، ولی اگر ۱.۴.۱۸ را هنوز پوش/ری‌دیپلوی نکرده‌اید، هر دو را با هم انجام دهید).
4. تست version.json = ۱.۴.۱۹/۲۴.
