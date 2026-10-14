# GITHUB UPDATE — v1.5.1 (versionCode 26)

## مراحل آپلود (کاربر)

۱. مخزن `ostad2fan/pompay` را باز کنید و پوشه `pampay-coin-alert-github` را با فایل‌های این بسته به‌روز کنید (فایل‌های تغییر کرده را جایگزین کنید؛ بقیه دست نخورده‌اند).

۲. حتماً این فایل‌ها را آپلود کنید:
- `apk/version.json` (نسخه ۱.۵.۱/۲۶)
- `apk/PampDumpCoins-v1.5.1.apk` (همان APK امضاشده این بسته)
- `app.json` + `package.json`
- `app/(tabs)/trade-ai/_layout.tsx` + `index.tsx` + `real-trade.tsx` — و **حذف `auto-trade.tsx`** (این صفحه در ۱.۵.۱ داخل تب «دمو» آمده و فایلش دیگر لازم نیست؛ اگر در مخزن ماند، مشکلی هم نمی‌سازد ولی بهتر است حذف شود)
- `app/(tabs)/settings/index.tsx`
- `components/AutoTradingBotSection.tsx` + `components/TradeAiSegmentHeader.tsx`
- `utils/tradeAiService.ts` + `utils/appUpdate.ts`
- `CHANGES-1.5.1.md`

۳. بعد از آپلود این آدرس را چک کنید که 1.5.1 نشان بدهد:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```

۴. Railway: این نسخه **فایل سرور ندارد** — تغییرات همه سمت اپ است؛ redeploy لازم نیست.

## نکته‌ها
- وابستگی جدیدی ندارد (همان بسته ۱.۵.۰) — نصب روی ۱.۵.۰ بدون حذف برنامه.
- آپدیت درون‌برنامه‌ای: jsdelivr → raw → رله Railway (مثل قبل).
