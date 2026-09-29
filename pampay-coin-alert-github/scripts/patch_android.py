#!/usr/bin/env python3
"""patch_android.py — post-prebuild patches for the local release APK build.

Run AFTER `npx expo prebuild -p android --clean` (which regenerates android/
from scratch and wipes any manual edits). Idempotent.

Patches:
  1. android/app/build.gradle
     - release signing with the generation-4 keystore (apk/keystore/…)
     - apply the google-services plugin (FCM push needs its generated
       resources; expo-notifications reads them at runtime)
  2. android/build.gradle
     - add the google-services classpath
  3. android/gradle.properties
     - slimming tweaks (arm64-only, minify, resource shrink, png crunch,
       legacy packaging) → APK stays under the 25 MB GitHub web-upload limit
     - memory-safe gradle JVM args for small build hosts
  4. android/app/google-services.json
     - copied from the project root if the prebuild didn't already place it
"""

import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
APP_GRADLE = os.path.join(ANDROID, "app", "build.gradle")
ROOT_GRADLE = os.path.join(ANDROID, "build.gradle")
GRADLE_PROPS = os.path.join(ANDROID, "gradle.properties")

KEYSTORE_REL = "../../apk/keystore/pampay-release-key.jks"
STORE_PASS = "PomPay2026Release"
KEY_ALIAS = "pampay"
KEY_PASS = "PomPay2026Release"

GOOGLE_SERVICES_CLASSPATH = "com.google.gms:google-services:4.4.2"


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def patch_app_gradle() -> None:
    s = read(APP_GRADLE)

    # 1) Release signing — merged INTO the template's existing
    #    `signingConfigs { debug { ... } }` block (right after its closing brace).
    if "pampay-release-key" not in s:
        release_cfg = (
            "        release {\n"
            f"            storeFile file('{KEYSTORE_REL}')\n"
            f"            storePassword '{STORE_PASS}'\n"
            f"            keyAlias '{KEY_ALIAS}'\n"
            f"            keyPassword '{KEY_PASS}'\n"
            "        }\n"
        )
        m = re.search(r"signingConfigs\s*\{\s*debug\s*\{[^}]*\}\s*\n(\s*)\}", s)
        if m:
            s = s[: m.end(1)] + release_cfg + s[m.end(1) :]
        else:
            # No debug block (template changed?) — insert a whole new block
            # after the opening `android {`.
            s2, n = re.subn(
                r"(^android\s*\{)",
                r"\1\n    signingConfigs {\n" + release_cfg + "    }\n",
                s,
                count=1,
                flags=re.M,
            )
            if n != 1:
                print("!! could not add release signing to app/build.gradle", file=sys.stderr)
            else:
                s = s2

    # 2) Point ONLY the release build type at the release keystore
    #    (leave the debug build type on the debug keystore).
    s = re.sub(
        r"(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug",
        r"\1signingConfig signingConfigs.release",
        s,
        count=1,
    )

    # 3) google-services plugin (idempotent)
    if "com.google.gms.google-services" not in s:
        s = re.sub(
            r"(^apply plugin:\s*['\"]com\.android\.application['\"])",
            r"\1\napply plugin: 'com.google.gms.google-services'",
            s,
            count=1,
            flags=re.M,
        )

    write(APP_GRADLE, s)
    print("   app/build.gradle patched (release signing + google-services)")


def patch_root_gradle() -> None:
    s = read(ROOT_GRADLE)
    if GOOGLE_SERVICES_CLASSPATH not in s:
        if "dependencies {" in s:
            s = s.replace(
                "dependencies {",
                f"dependencies {{\n        classpath '{GOOGLE_SERVICES_CLASSPATH}'",
                1,
            )
        elif "buildscript {" in s:
            s = s.replace(
                "buildscript {",
                "buildscript {\n    dependencies {\n"
                f"        classpath '{GOOGLE_SERVICES_CLASSPATH}'\n"
                "    }\n",
                1,
            )
        else:
            print("!! could not add google-services classpath to root build.gradle", file=sys.stderr)
    write(ROOT_GRADLE, s)
    print("   build.gradle patched (google-services classpath)")


def patch_gradle_properties() -> None:
    path = GRADLE_PROPS
    s = read(path)
    tweaks = {
        "reactNativeArchitectures": "arm64-v8a",
        "expo.useLegacyPackaging": "true",
        "android.enableMinifyInReleaseBuilds": "true",
        "android.enableShrinkResourcesInReleaseBuilds": "true",
        "android.enablePngCrunchInReleaseBuilds": "true",
        # Memory-safe for small build hosts (4 GB): in-process Kotlin compiler
        # avoids the separate Kotlin daemon that can deadlock on low RAM.
        "org.gradle.jvmargs": "-Xmx1536m -XX:MaxMetaspaceSize=768m",
        "org.gradle.parallel": "true",
        "org.gradle.caching": "true",
        "org.gradle.workers.max": "2",
        "kotlin.compiler.execution.strategy": "in-process",
        "kotlin.daemon.jvmargs": "-Xmx1024m",
    }
    for key, val in tweaks.items():
        pattern = rf"^{re.escape(key)}=.*$"
        if re.search(pattern, s, flags=re.M):
            s = re.sub(pattern, f"{key}={val}", s, flags=re.M)
        else:
            s += f"\n{key}={val}"
    write(path, s)
    print("   gradle.properties patched (slimming + memory)")


def ensure_google_services_json() -> None:
    src = os.path.join(ROOT, "google-services.json")
    dst = os.path.join(ANDROID, "app", "google-services.json")
    if os.path.exists(src) and not os.path.exists(dst):
        # Validate JSON before copying — a broken file breaks the gradle build.
        try:
            with open(src, encoding="utf-8") as f:
                json.load(f)
        except Exception as e:
            print(f"!! google-services.json is not valid JSON ({e}) — NOT copied", file=sys.stderr)
            return
        shutil.copyfile(src, dst)
        print("   google-services.json copied to android/app/")
    elif os.path.exists(dst):
        print("   google-services.json already in android/app/")
    else:
        print("   (no google-services.json — push stays Telegram-only)")


if __name__ == "__main__":
    for step in (patch_app_gradle, patch_root_gradle, patch_gradle_properties, ensure_google_services_json):
        step()
    print("All android patches applied.")
