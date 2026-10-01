# راهنمای به‌روزرسانی گیت‌هاب به نسخه ۱.۴.۷

این فایل کنار فایل‌های تغییر یافته نسخه ۱.۴.۷ قرار دارد. مخزن گیت‌هاب شما (`ostad2fan/pompay`) در حال حاضر نسخه ۱.۴.۶ را دارد — **فقط همین ۱۷ فایل** را باید جایگزین/اضافه کنید (نه کل پوشه).

## روش آپلود (۲ دقیقه)

1. گیت‌هاب را باز کنید → مخزن `ostad2fan/pompay` → وارد پوشه `pampay-coin-alert-github` شوید.
2. دکمه **Add file → Upload files** را بزنید.
3. فایل‌های این فایل‌زیپ را (که ساختار پوشه‌ای درست دارند) به‌کپی داخل صفحه بکشید:
   - دقت: برای فایل‌هایی که داخل زیرپوشه‌اند (`app/...`، `utils/...`، `components/...`، `docs/...`، `apk/...`، `server/...`)، اول داخل همان زیرپوشه در گیت‌هاب بروید بعد Upload files بزنید و فایل را بکشید (گیت‌هاب آپلود با زیرپوشه را در حالت درگ‌کردن چندپوشه‌ای گاهی نمی‌پذیرد).
   - ترتیب پیشنهادی: هر زیرپوشه یک بار.
4. **Commit changes** را بزنید.

## فایل‌های تغییر یافته (۱۷)

| فایل | تغییر |
|---|---|
| `README.md` | بخش تغییرات ۱.۴.۷ |
| `CHANGES-1.4.7.md` | **جدید** — گزارش کامل فارسی |
| `app.json` | version 1.4.7 / versionCode 12 |
| `utils/appUpdate.ts` | نسخه ۱.۴.۷ / کد ۱۲ |
| `apk/version.json` | 1.4.7 / 12 + توضیحات |
| `apk/PampDumpCoins-latest.apk` | **APK جدید** (نصب روی ۱.۴.۶ بدون حذف) |
| `app/_layout.tsx` | اتصال گیت استارتاپ |
| `components/StartupIpGate.tsx` | **جدید** — صفحه گیت IP هنگام باز شدن برنامه |
| `utils/vpnGuard.ts` | getIpInfo (IP + کشور) |
| `app/(tabs)/wallet/index.tsx` | گیت ایران + PnL بالای لیست + PnL کل + ارزینجا/بیت‌پرپ |
| `utils/arzinjaV2Api.ts` | **جدید** — API واقعی v2 ارزینجا (امضای X-ARZ) |
| `utils/nobitexApi.ts` | دامنه جدید نوبیتکس + قیمت تتر ارزینجا |
| `utils/bitperpApi.ts` | رفرش مقاوم + خطاهای واقعی |
| `utils/scanServerApi.ts` | دلیل دقیق خطای همگام‌سازی |
| `app/(tabs)/settings/index.tsx` | نمایش دلیل خطا |
| `server/src/nobitex.ts` | دامنه جدید نوبیتکس (سرور Railway — نیاز به Redeploy) |
| `docs/RAILWAY-KEEPALIVE.md` | **جدید** — راهنمای Redeploy + جلوگیری از خوابیدن Railway |

## بعد از آپلود

1. این آدرس باید نسخه ۱.۴.۷ را نشان دهد:
   `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json`
2. اگر آپدیت درون‌برنامه‌ای دیرتر رسید: کش jsDelivr را خالی کنید —
   `https://www.jsdelivr.com/tools/purge` و آدرس `https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/version.json` را بدهید.
3. **Redeploy سرور Railway** (چون `server/src/nobitex.ts` عوض شد + سرور الان خاموش است): طبق `docs/RAILWAY-KEEPALIVE.md`.
4. **cron-job.org**: هر ۵ دقیقه به `https://pompay-production.up.railway.app/health` — تا سرور دیگر نخوابد (جزئیات در همان فایل).

## نکته امنیتی keystore

`apk/keystore/pampay-release-key.jks` برای نصب-روی-نسخه-قبلی لازم است و در مخزن می‌ماند؛ اما ریپو شما عمومی است — هر کسی می‌تواند آن را بردارد و APK هم‌امضا با نام پکیج شما بسازد. اگر نگرانید ریپو را Private کنید (تنظیمات مخزن → Danger Zone → Change visibility).
