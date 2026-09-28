# تغییرات نسخه ۱.۴.۱

تاریخ: ۱۴۰۵/۰۷/۰۶ (2026-09-28)

## هدف این نسخه

فعال‌سازی پوش نوتیفیکیشن + سبک‌سازی فایل‌ها برای آپلود در گیت‌هاب.

## تغییرات

### ۱) پوش نوتیفیکیشن
- **projectId اکسپو** (`859ac9be-21fe-4e83-9905-14c017c0eb87`) در `app.json` → `extra.eas.projectId` ثبت شد؛ با هر بیلد به‌صورت خودکار داخل APK (فایل `assets/app.config`) قرار می‌گیرد.
- `utils/pushService.ts`: projectId پشتیبان (fallback) اضافه شد تا حتی اگر `Constants.expoConfig` در دسترس نباشد، توکن پوش گرفته شود.
- `utils/pushService.ts`: تابع جدید `sendTestLocalNotification()` — نوتیف **محلی** فوری برای تست.
- صفحه تنظیمات: دکمه جدید **«تست نمایش نوتیفیکیشن»** (زیر دکمه ثبت پوش) — بدون نیاز به فایربیس، مجوز و کانال اعلان را روی گوشی تست می‌کند.
- `android/app/build.gradle` + `android/build.gradle`: پلاگین `google-services` **پیش‌سیم‌کشی** شد — به‌محض قرار گرفتن فایل `android/app/google-services.json` (از کنسول فایربیس، پکیج `com.trademaster.pampaycoin`) در بیلد بعدی به‌صورت خودکار فعال می‌شود و پوش روی اندروید کامل می‌شود. تا آن زمان تلگرام مسیر اصلی اعلان با برنامه بسته است.

### ۲) سبک‌سازی APK برای گیت‌هاب
- `android/gradle.properties`:
  - `reactNativeArchitectures=arm64-v8a` — فقط معماری arm64 (گوشی‌های ۲۰۱۸ به بعد)
  - `expo.useLegacyPackaging=true` — فشرده‌سازی کتابخانه‌های نیتیو داخل APK
  - `android.enableMinifyInReleaseBuilds=true` + `android.enableShrinkResourcesInReleaseBuilds=true` — حذف کد و منابع استفاده‌نشده (R8)
  - `android.enablePngCrunchInReleaseBuilds=true`
- نتیجه: حجم APK از **۴۶.۵ مگابایت به حدود ۲۰ مگابایت** رسید — زیر سقف ۲۵ مگابایتی آپلود وب‌سایت گیت‌هاب.

### ۳) نسخه
- `versionCode`: 5 → **6**
- `versionName`: 1.4.0 → **1.4.1**
- نصب مستقیم روی نسخه‌های قبلی بدون حذف (امضای keystore همان است).
