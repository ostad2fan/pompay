# راهنمای به‌روزرسانی گیت‌هاب به نسخه ۱.۴.۸

مخزن شما در حال حاضر نسخه ۱.۴.۷ را دارد — فقط همین ۱۸ فایل را جایگزین/اضافه کنید.

## روش آپلود

1. گیت‌هاب → مخزن `ostad2fan/pompay` → پوشه `pampay-coin-alert-github` → زیرپوشه مربوط به هر فایل را باز کنید.
2. **Add file → Upload files** → فایل‌های زیپ را بکشید → **Commit changes**.
3. برای فایل‌های داخل زیرپوشه‌ها، اول داخل همان زیرپوشه بروید (مثلا `utils/` برای فایل‌های utils).

## فایل‌های تغییر یافته (۱۸)

| فایل | تغییر |
|---|---|
| `README.md` | بخش تغییرات ۱.۴.۸ |
| `CHANGES-1.4.8.md` | **جدید** — گزارش کامل فارسی |
| `app.json` | version 1.4.8 / versionCode 13 |
| `utils/appUpdate.ts` | نسخه ۱.۴.۸ / کد ۱۳ |
| `apk/version.json` | 1.4.8 / 13 + توضیحات |
| `apk/PampDumpCoins-latest.apk` | **APK جدید** (نصب روی ۱.۴.۷ بدون حذف) |
| `apk/keystore/pampay-release-key.jks` | کلید امضا (برای بیلدهای بعدی — در ریپوی شما نبود؛ اگر نمی‌خواهید عمومی باشد، آپلودش نکنید و فقط نگهش دارید) |
| `app/_layout.tsx` | VpnGateProvider دور کل برنامه |
| `contexts/VpnGateContext.tsx` | **جدید** — پولر مشترک IP (هر ۱۵ ثانیه) |
| `components/StartupIpGate.tsx` | بازنویسی — صفحه قفل شامل حالت «وسط کار خاموش شد» |
| `components/IpStatusCard.tsx` | **جدید** — کارت IP بالای تنظیمات |
| `contexts/AppContext.tsx` | گیت ایران برای اسکنر اصلی |
| `app/(tabs)/meme-scanner/index.tsx` | گیت ایران برای اسکنر میم |
| `app/(tabs)/pre-listing/index.tsx` | گیت ایران برای قبل از لیست |
| `app/(tabs)/settings/index.tsx` | کارت IP در ابتدای لیست |
| `app/(tabs)/wallet/index.tsx` | PnL اسپات بایننس + مکسی/بیتگت + فیلتر موجودی کوچک |
| `utils/foreignExchangePnl.ts` | **جدید** — PnL دوره‌ای مکسی و بیتگت |
| `scripts/patch_gradle_ram.py` | **جدید** — برای بیلد محلی با رم کم |

## بعد از آپلود

1. `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید ۱.۴.۸ نشان دهد.
2. اگر آپدیت درون‌برنامه‌ای دیر رسید، کش jsDelivr را خالی کنید: https://www.jsdelivr.com/tools/purge با آدرس version.json.
3. سرور Railway نیازی به Redeploy ندارد (کد سرور تغییر نکرد) — فقط مطمئن شوید cron-job هر ۵ دقیقه به /health می‌زند.
