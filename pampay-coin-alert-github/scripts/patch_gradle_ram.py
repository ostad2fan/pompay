#!/usr/bin/env python3
"""patch_gradle_ram.py — memory-safety patches for the 4GB build sandbox.

Run AFTER `npx expo prebuild` (android/ is regenerated each time, wiping the
previous patches):

  1. android/gradle.properties
     - kotlin.compiler.execution.strategy=in-process (no separate Kotlin
       daemon — the #1 OOM killer on 3.9GB RAM hosts)
     - org.gradle.workers.max=2
     - SerialGC + tighter heap
  2. android/app/build.gradle
     - lint { checkReleaseBuilds false } — lintVitalAnalyzeRelease OOMs the
       build host and `-x lint` does NOT skip lintVital.
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
GRADLE_PROPS = os.path.join(ANDROID, "gradle.properties")
APP_GRADLE = os.path.join(ANDROID, "app", "build.gradle")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def main() -> None:
    # ---- gradle.properties ----
    s = read(GRADLE_PROPS)
    s = re.sub(
        r"org\.gradle\.jvmargs=.*",
        "org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseSerialGC",
        s,
        count=1,
    )
    s = re.sub(r"kotlin\.daemon\.jvmargs=.*", "kotlin.daemon.jvmargs=-Xmx512m", s, count=1)
    additions = ""
    if "kotlin.compiler.execution.strategy" not in s:
        additions += "\nkotlin.compiler.execution.strategy=in-process\n"
    if "org.gradle.workers.max" not in s:
        additions += "org.gradle.workers.max=2\n"
    s += additions
    write(GRADLE_PROPS, s)
    print("gradle.properties patched (in-process Kotlin, workers=2, SerialGC)")

    # ---- app/build.gradle: disable release lint ----
    s = read(APP_GRADLE)
    if "checkReleaseBuilds" not in s:
        s2, n = re.subn(
            r"(^android\s*\{)",
            r"\1\n    lint {\n        checkReleaseBuilds false\n        abortOnError false\n    }\n",
            s,
            count=1,
            flags=re.M,
        )
        if n == 1:
            write(APP_GRADLE, s2)
            print("app/build.gradle patched (lintVital disabled)")
        else:
            print("!! could not insert lint block", flush=True)


if __name__ == "__main__":
    main()
