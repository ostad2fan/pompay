# GITHUB UPDATE — v1.5.0 (versionCode 25)

## مراحل آپلود (کاربر)

۱. مخزن `ostad2fan/pompay` را باز کنید و پوشه `pampay-coin-alert-github` را با فایل‌های این بسته به‌روز کنید (فایل‌های تغییر کرده را جایگزین کنید؛ بقیه دست نخورده‌اند).

۲. حتماً این فایل‌ها را آپلود کنید:
- `apk/version.json` (نسخه ۱.۵.۰/۲۵)
- `apk/PampDumpCoins-v1.5.0.apk` (همان APK امضاشده این بسته)
- `app.json` + `package.json`
- `app/_layout.tsx`
- `app/(tabs)/trade-ai/_layout.tsx` + `index.tsx` + `real-trade.tsx` + `auto-trade.tsx` (جدید)
- `app/(tabs)/settings/index.tsx`
- `app/(tabs)/wallet/index.tsx`
- `components/AutoTradingBotSection.tsx` + `TradeAiSegmentHeader.tsx` (جدید) + `LocalAssetsSection.tsx` + `BlockchainWalletsSection.tsx`
- `utils/autoTradingEngine.ts` + `utils/appUpdate.ts`
- `CHANGES-1.5.0.md`

۳. بعد از آپلود این آدرس را چک کنید که 1.5.0 نشان بدهد:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```

۴. Railway: این نسخه **فایل سرور ندارد** — تغییرات همه سمت اپ است؛ اگر فایل‌های سرور ۱.۴.۱۸/۱۹ را هنوز پوش نکرده‌اید، همان موقع یک‌بار redeploy کنید.

## نکته‌ها
- خروجی عکس PnL نیاز به سه پکیج جدید دارد (react-native-view-shot + expo-sharing + expo-media-library) که در package.json اضافه شده‌اند — فقط با APK جدید کار می‌کنند (وب خیر).
- آپدیت درون‌برنامه‌ای: jsdelivr → raw → رله Railway (مثل قبل).
