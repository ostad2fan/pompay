#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ساخت APK اندروید به‌صورت محلی — نسخه ۱.۴.۱۰
#
# این اسکریپت همه‌چیز را خودش انجام می‌دهد:
#   1) expo prebuild (بازسازی پوشه android با فایربیس google-services.json)
#   2) وصله‌های post-prebuild:
#        - امضای release با کلید نسل ۴ (keystore/ یا apk/keystore/)
#        - پلاگین google-services برای پوش فایربیس
#        - سبک‌سازی gradle (arm64 فقط + minify + فشرده‌سازی) → APK زیر ۲۵MB
#        - تنظیمات حافظه (gradle RAM patches)
#   3) gradle assembleRelease
#
# پیش‌نیازها: Node 20+، JDK 17 (~/jdk)، ANDROID_HOME (~/android-sdk) —
# اگر ریست شده‌اند اول scripts/ بیرونی setup-build-toolchain.sh را اجرا کنید.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk/jdk-17.0.20.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/gradle-home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
echo "==> JAVA_HOME=$JAVA_HOME"
echo "==> ANDROID_HOME=$ANDROID_HOME"
echo "==> GRADLE_USER_HOME=$GRADLE_USER_HOME"

if [[ ! -x "$JAVA_HOME/bin/java" || ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
  echo "!! toolchain missing — run /home/z/my-project/scripts/setup-build-toolchain.sh first"
  exit 1
fi

if [[ ! -f keystore/pampay-release-key.jks && ! -f apk/keystore/pampay-release-key.jks ]]; then
  echo "!! release keystore not found — cannot sign (install-over would break)"
  exit 1
fi

if [[ ! -f google-services.json ]]; then
  echo "!! فایل google-services.json در ریشه پروژه نیست — پوش فایربیس غیرفعال می‌ماند"
fi

echo "==> 1/4 نصب وابستگی‌ها (اگر لازم باشد)"
[[ -d node_modules ]] || npm install --legacy-peer-deps --no-audit --no-fund

echo "==> 2/4 expo prebuild (پاک و بازسازی android/)"
rm -rf android
npx expo prebuild -p android --clean --no-install

echo "==> 3/4 وصله‌های post-prebuild (امضا + فایربیس + سبک‌سازی + حافظه)"
python3 scripts/patch_android.py
python3 scripts/patch_gradle_ram.py

echo "==> 4/4 gradle assembleRelease"
cd android
# v1.4.10 — limit the native (CMake/ninja) build to 2 clang jobs so the
# daemon + compiler stay inside the 4GB sandbox (daemon OOM'd at -j default).
export CMAKE_BUILD_PARALLEL_LEVEL=2
./gradlew assembleRelease --no-daemon -x lint

OUT="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$OUT" ]] || OUT="app/build/outputs/apk/release/app-release.apk"
echo "==> خروجی: $OUT"
