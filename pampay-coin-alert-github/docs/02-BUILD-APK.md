# راهنمای ساخت APK اندروید 📱

دو راه دارید: **ساخت ابری EAS** (آسان، بدون نیاز به کامپیوتر قوی) یا **ساخت لوکال**.

## راه ۱: ساخت ابری با EAS (پیشنهادی)

### پیش‌نیاز
- اکانت رایگان [expo.dev](https://expo.dev)

### مراحل
```bash
cd app
npm install --legacy-peer-deps

# نصب CLI
npm install -g eas-cli

# ورود به اکانت Expo
eas login

# ساخت APK (پروفایل preview از قبل آماده است)
eas build -p android --profile preview
```

بعد از ~۱۵-۳۰ دقیقه لینک دانلود APK به شما داده می‌شود.

## راه ۲: ساخت لوکال (کامپیوتر با ۱۶GB رم)

### پیش‌نیازها
- Node.js 20+
- JDK 17
- Android SDK (با Android Studio یا cmdline-tools)

### مراحل
```bash
cd app
npm install --legacy-peer-deps

# ساخت پروژه اندروید از کد اکسپو
npx expo prebuild -p android

# ساخت APK
cd android
./gradlew assembleRelease
```

خروجی: `android/app/build/outputs/apk/release/app-release.apk`

> ⚠️ اگر خطای signing گرفتید، در `android/app/build.gradle` بخش `signingConfigs` را با keystore خودتان تنظیم کنید یا موقتاً `assembleDebug` بگیرید.

## نصب روی گوشی (بدون حذف نسخه قبلی!)
1. فایل APK را به گوشی منتقل کنید
2. اجازه «نصب از منابع ناشناس» را بدهید
3. روی فایل بزنید — اندروید به‌جای نصب جدید، همان برنامه را «بروزرسانی» می‌کند و همه تنظیمات/کلیدها/دارایی‌ها حفظ می‌شوند
4. اولین اجرا: اجازه **Notifications** را حتماً تأیید کنید ✅

> ⚠️ **سه قانون نصب-روی-نسخه-قبلی** (در غیر این صورت اندروید «ناسازگار» می‌گوید و حذف می‌خواهد):
> 1. `android.package` در `app.json` را تغییر ندهید (`com.trademaster.pampaycoin`)
> 2. همیشه با **همان keystore قبلی** بیلد بگیرید (EAS خودش نگه می‌دارد؛ لوکال: همیشه debug یا همیشه release با همان keystore)
> 3. `android.versionCode` را برای هر نسخه جدید فقط **افزایش** دهید (نسخه 1.3.0 → versionCode 4)

## تنظیمات بعد از نصب
1. ✅ **سرور اسکن**: دیگر نیازی به وارد کردن آدرس نیست — آدرس `pompay-production.up.railway.app` از قبل داخل برنامه قرار داده شده و خودکار پر شده است (فقط برای سرور شخصی ویرایشش کنید)
2. **تنظیمات → ربات تلگرام**: توکن ربات + Chat ID → فعال‌سازی
3. برای اعلان مطمئن‌تر در اندروید: Settings گوشی → Battery → اپ را روی **Unrestricted** بگذارید

## راه ۳: اعلان پوش خود اپ (FCM)
برای اینکه نوتیفیکیشن خود اپ (علاوه بر تلگرام) با برنامه بسته برسد:
1. در [console.firebase.google.com](https://console.firebase.google.com) پروژه بسازید
2. یک اپ Android با پکیج‌نیم `app.rork.pampay_coin_alert` اضافه کنید
3. فایل `google-services.json` را دانلود و در پوشه `app/` بگذارید
4. یک project id از Expo بگیرید و در `app/app.json` بخش `extra.eas.projectId` قرار دهید
5. دوباره APK بسازید

راهنمای کامل: [03-PUSH-NOTIFICATIONS.md](03-PUSH-NOTIFICATIONS.md)
