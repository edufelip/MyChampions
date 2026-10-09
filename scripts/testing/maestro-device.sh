#!/usr/bin/env bash
# Prepare the device a Maestro suite runs on: boot (iOS) or require (Android) a
# device, then install the debug app. Maestro itself never installs or boots.
#
#   scripts/testing/maestro-device.sh --platform ios|android [--app PATH]
#   scripts/testing/maestro-device.sh --platform ios|android --resolve-only
#
# --resolve-only prints the device id the suite must target and changes
# nothing. iOS uses MAESTRO_IOS_SIMULATOR (default "iPhone 17"), reusing a
# booted simulator with that name. Android uses ANDROID_SERIAL when set,
# otherwise the single attached device.
set -euo pipefail

platform=""
app=""
resolve_only=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) platform="$2"; shift 2 ;;
    --app) app="$2"; shift 2 ;;
    --resolve-only) resolve_only=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ios_udid() {
  local name="${MAESTRO_IOS_SIMULATOR:-iPhone 17}"
  xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, sys
name = sys.argv[1]
devices = [d for runtime in json.load(sys.stdin)["devices"].values() for d in runtime if d["name"] == name]
booted = [d for d in devices if d["state"] == "Booted"]
pick = (booted or devices or [None])[0]
print(pick["udid"] if pick else "")
' "$name"
}

android_serial() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    printf '%s\n' "$ANDROID_SERIAL"
    return
  fi
  local serials count
  serials="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
  count="$(printf '%s' "$serials" | grep -c . || true)"
  if [[ "$count" -ne 1 ]]; then
    echo "Expected exactly one Android device, found $count; set ANDROID_SERIAL." >&2
    return 1
  fi
  printf '%s\n' "$serials"
}

if [[ "$platform" == "ios" ]]; then
  udid="$(ios_udid)"
  [[ -n "$udid" ]] || {
    echo "No available simulator named \"${MAESTRO_IOS_SIMULATOR:-iPhone 17}\"." >&2
    exit 1
  }
  if [[ "$resolve_only" == true ]]; then
    printf '%s\n' "$udid"
    exit 0
  fi
  app="${app:-$project_root/ios/build/Build/Products/Debug-iphonesimulator/mychampions.app}"
  [[ -d "$app" ]] || { echo "iOS app not found: $app" >&2; exit 1; }
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  echo "Installed $(basename "$app") on simulator $udid."
elif [[ "$platform" == "android" ]]; then
  serial="$(android_serial)"
  if [[ "$resolve_only" == true ]]; then
    printf '%s\n' "$serial"
    exit 0
  fi
  app="${app:-$project_root/android/app/build/outputs/apk/dev/debug/app-dev-debug.apk}"
  [[ -f "$app" ]] || { echo "Android APK not found: $app" >&2; exit 1; }
  adb -s "$serial" wait-for-device
  adb -s "$serial" install -r -t "$app" >/dev/null
  echo "Installed $(basename "$app") on $serial."
else
  echo "Usage: $0 --platform ios|android [--app PATH | --resolve-only]" >&2
  exit 2
fi
