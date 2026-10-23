# GITHUB-UPDATE — v1.5.9 (versionCode 34)

این فایل را بعد از آپلود zip در مخزن نگه ندارید — فقط مراحل را انجام دهید.

## مراحل آپلود (مخزن `ostad2fan/pompay` ← پوشه `pampay-coin-alert-github`)

۱. محتوای zip آپدیت را دقیقاً روی همان مسیرها جایگزین کنید (فایل‌های تغییر یافته):

```
app.json
app/(tabs)/settings/index.tsx
components/AutoTradingBotSection.tsx
utils/autoTradingEngine.ts
utils/scanServerApi.ts
utils/appUpdate.ts
apk/version.json
apk/PampDumpCoins-v1.5.9.apk          ← فایل جدید (به‌جای v1.5.8)
apk/PampDumpCoins-latest.apk          ← همان فایل جدید (تکرار)
server/src/backtestEngine.ts          ← ⚠️ کد سرور — Railway حتماً redeploy
server/src/index.ts                   ← ⚠️ کد سرور
server/src/scanEngine.ts              ← ⚠️ کد سرور
CHANGES-1.5.9.md                        ← فایل جدید
```

۲. فایل APK قدیمی (`PampDumpCoins-v1.5.8.apk`) را از پوشه apk حذف کنید (فقط نسخه جدید + latest بماند).

۳. **Railway را حتماً دوباره deploy کنید** (Deploy latest commit):
   - بدون redeploy: توقف پیام «فعال شد» با هر باز شدن برنامه رفع نمی‌شود (سرور قدیمی روی هر push پیام می‌فرستد)، برنامه‌باز با heartbeat مکث نمی‌کند (معامله/اعلان دوبله)، سلامت‌سنجی «سرور کد قدیمی دارد» می‌گوید و بازپس‌گیری سرور با کد تلگرام کار نمی‌کند.

۴. بعد از deploy این آدرس را چک کنید:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```
باید 1.5.9 / 34 نشان بدهد.

۵. (تست پیشنهادی) در برنامه: تنظیمات ← «بررسی سلامت اعلان‌های ۲۴/۷» — باید serverCode سرور جدید را ببیند و وضعیت بخش‌ها ✅/⛔️ نشان دهد (نه «کد قدیمی»).
