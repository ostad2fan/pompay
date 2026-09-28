#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ساخت APK اندروید به‌صورت محلی (اختیاری)
# روش پیشنهادی و ساده‌تر: EAS Build (بخش README مرحله ۳)
# این اسکریپت برای کسانی است که می‌خواهند روی کامپیوتر خودشان
# با Android Studio / SDK بیلد بگیرند.
#
# پیش‌نیازها:
#   - Node.js >= 20
#   - JDK 17 (java -version)
#   - Android SDK با platform 35 + build-tools 35 (ANDROID_HOME ست شده)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

echo "==> 1/4 نصب وابستگی‌ها"
npm install

echo "==> 2/4 خروجی گرفتن پیکربندی native اندروید (prebuild)"
npx expo prebuild -p android --clean

echo "==> 3/4 بیلد با Gradle (نوع: APK debug-امضا برای تست / release برای انتشار)"
cd android
if [[ "${1:-release}" == "debug" ]]; then
  ./gradlew assembleDebug
  echo "==> خروجی: android/app/build/outputs/apk/debug/app-debug.apk"
else
  ./gradlew assembleRelease
  echo "==> خروجی: android/app/build/outputs/apk/release/app-release.apk"
fi
