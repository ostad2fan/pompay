# راهنمای آپدیت گیت‌هاب — نسخه ۱.۴.۱۸ (versionCode 23)

> گیت‌هاب شما الان نسخه ۱.۴.۱۷ **ناقص** است (۶ شبکه، بدون تون‌کیپر/نهنگ/اعلان‌ها/PnL سه‌سطحی).
> این نسخه هر دو شاخه ۱.۴.۱۷ را یکی می‌کند. **همه فایل‌های زیپ را جایگزین کنید.**

## فایل‌های جدید
- `utils/blake2b.ts` (BLAKE2b خالص — خواندن آدرس پولکادات)
- `server/src/whaleWatch.ts` (رصد ۲۴ ساعته پوزیشن نهنگ‌ها)

## فایل‌های جایگزین (اپ)
- `app.json` `apk/version.json` `utils/appUpdate.ts` → ۱.۴.۱۸ / 23
- `utils/blockchainWallets.ts` — ۵۱ شبکه + ۶ توکن ترون + مهاجرت داده
- `utils/blockchainWalletApi.ts` — Multicall3 + ۲۳ خواننده شبکه + قیمت اسپات/فیوچرز/CoinGecko + PnL
- `components/BlockchainWalletsSection.tsx` — منوی کشویی + PnL سه‌سطحی + ویرایش + رفرش
- `components/LocalAssetsSection.tsx` — ردیف‌های کریپتو در دارایی ریالی
- `app/(tabs)/wallet/index.tsx` — چندشبکه‌ای + قیمت اختصاصی بیت‌پرپ + فیوچرز + نگهداشتن ردیف‌های بدون قیمت
- `app/(tabs)/settings/index.tsx` — راهنمای بازنویسی‌شده
- `contexts/AppContext.tsx` — همگام‌سازی نهنگ‌ها
- `utils/scanServerApi.ts` `utils/telegramService.ts` — دستورات و همگام‌سازی جدید

## فایل‌های جایگزین (سرور — Railway را Redeploy کنید)
- `server/src/scanEngine.ts` — ادغام پیکربندی + ذخیره /data + هوک ساعتی
- `server/src/index.ts` — خودترمیم پیکربندی + نهنگ‌چاق در تیک سریع
- `server/src/botCommands.ts` — /whale /portfolio /balance /status

## مراحل
1. محتوای `pompay-github-v1.4.18-update.zip` را استخراج کنید (ساختار پوشه‌ها حفظ شده).
2. همه را در `pampay-coin-alert-github/` ریپو `ostad2fan/pompay` جایگزین/اضافه کنید.
3. APK قدیمی (v1.4.17) را از `apk/` حذف و `PampDumpCoins-v1.4.18.apk` را بگذارید.
4. کامیت و پوش.
5. **Railway → Deploy latest** (بدون این، اعلان نهنگ/خودترمیم فعال نمی‌شود).
6. تست: `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید ۱.۴.۱۸/۲۳ نشان دهد.
