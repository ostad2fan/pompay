#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ساخت APK اندروید به‌صورت محلی — نسخه ۱.۴.۴
#
# این اسکریپت همه‌چیز را خودش انجام می‌دهد:
#   1) expo prebuild (بازسازی پوشه android با فایربیس google-services.json)
#   2) وصله‌های post-prebuild:
#        - امضای release با کلید نسل ۴ (apk/keystore/pampay-release-key.jks)
#        - پلاگین google-services برای پوش فایربیس
#        - سبک‌سازی gradle (arm64 فقط + minify + فشرده‌سازی) → APK زیر ۲۵MB
#   3) gradle assembleRelease
#
# پیش‌نیازها: Node 20+، JDK 17+، ANDROID_HOME (platform-tools +
#   platforms;android-36 + build-tools;36.0.0)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
echo "==> ANDROID_HOME=$ANDROID_HOME"

if [[ ! -f google-services.json ]]; then
  echo "!! فایل google-services.json در ریشه پروژه نیست — پوش فایربیس غیرفعال می‌ماند"
fi

echo "==> 1/4 نصب وابستگی‌ها (اگر لازم باشد)"
[[ -d node_modules ]] || npm install --legacy-peer-deps --no-audit --no-fund

echo "==> 2/4 expo prebuild (پاک و بازسازی android/)"
rm -rf android
npx expo prebuild -p android --clean --no-install

echo "==> 3/4 وصله‌های post-prebuild (امضا + فایربیس + سبک‌سازی)"
python3 scripts/patch_android.py

echo "==> 4/4 gradle assembleRelease"
cd android
./gradlew assembleRelease --no-daemon -x lint

OUT="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$OUT" ]] || OUT="app/build/outputs/apk/release/app-release.apk"
echo "==> خروجی: $OUT"
