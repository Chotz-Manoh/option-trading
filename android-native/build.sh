#!/bin/bash
# Builds OptionPulse.apk without Gradle or AndroidX: aapt + javac + dx + zipalign + apksigner.
# Works with Ubuntu/Debian's Android tools:
#   sudo apt install aapt dalvik-exchange apksigner zipalign android-sdk-platform-23 openjdk-17-jdk
#
# usage: android-native/build.sh <version> <keystore.jks> <password> [github-owner/repo] [out.apk]
set -euo pipefail
VER=${1:?version, e.g. 1.1.0}
KS=${2:?keystore}
PASS=${3:?keystore password}
REPO=${4:-}
OUT=${5:-release/OptionPulse.apk}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
N=$ROOT/android-native
B=$N/build
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
IFS=. read -r MA MI PA <<< "$VER"
CODE=$((MA * 10000 + MI * 100 + PA))
case "$OUT" in /*) ;; *) OUT=$ROOT/$OUT ;; esac

rm -rf "$B"
mkdir -p "$B/gen" "$B/classes" "$B/assets/public" "$B/src/com/devkodz/optionpulse"

echo "1/5 web app"
(cd "$ROOT" && APP_VERSION=$VER UPDATE_REPO=$REPO npx vite build --outDir "$B/assets/public" --emptyOutDir > "$B/vite.log")

echo "2/5 manifest"
sed "s/@VERSION_CODE@/$CODE/; s/@VERSION_NAME@/$VER/" "$N/AndroidManifest.xml" > "$B/AndroidManifest.xml"
cat > "$B/src/com/devkodz/optionpulse/Config.java" <<EOF
package com.devkodz.optionpulse;

final class Config {
    static final String VERSION_NAME = "$VER";
    /** Updates are only accepted from https://github.com/<UPDATE_REPO>/releases/download/... */
    static final String UPDATE_REPO = "$REPO";
}
EOF

echo "3/5 resources"
aapt package -f -m -M "$B/AndroidManifest.xml" -S "$N/res" -A "$B/assets" -I "$ANDROID_JAR" -J "$B/gen" -F "$B/app.unsigned.apk"

echo "4/5 code"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$B/classes" \
  $(find "$N/src" "$B/src" "$B/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"
(cd "$B" && aapt add app.unsigned.apk classes.dex > /dev/null)

echo "5/5 align + sign"
zipalign -f -p 4 "$B/app.unsigned.apk" "$B/app.aligned.apk"
mkdir -p "$(dirname "$OUT")"
apksigner sign --ks "$KS" --ks-key-alias optionpulse --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --min-sdk-version 24 --out "$OUT" "$B/app.aligned.apk"
apksigner verify --min-sdk-version 24 --print-certs "$OUT" | head -3
echo "Built $OUT (version $VER, code $CODE)"
