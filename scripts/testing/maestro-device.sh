#!/usr/bin/env bash
# Prepare the device a Maestro suite runs on: boot (iOS) or require (Android) a
# device, then install the debug app. Maestro itself never installs or boots.
#
#   scripts/testing/maestro-device.sh --platform ios|android [--app PATH]
#   scripts/testing/maestro-device.sh --platform ios|android --resolve-only
#
# --resolve-only prints the device id the suite must target and changes
# nothing. iOS uses the simulator named MAESTRO_IOS_SIMULATOR (default
# "MyChampions Maestro"), creating it from MAESTRO_IOS_DEVICE_TYPE (default
# "iPhone 17") when missing and pinning it to English (en_US) so the suite's
# text assertions do not depend on a shared simulator's language. Android uses
# ANDROID_SERIAL when set, otherwise the single attached device; it needs API
# 33+ and an en-US system language, and the installed app is pinned to en-US
# with Android's per-app language setting.
set -euo pipefail

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

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

ios_name="${MAESTRO_IOS_SIMULATOR:-MyChampions Maestro}"
# The devDebug APK's application id: the appId every suite flow targets.
android_app_id=com.edufelip.mychampions.dev

ios_udid() {
  local name="$ios_name"
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
  if [[ "$resolve_only" == true ]]; then
    [[ -n "$udid" ]] || { echo "No simulator named \"$ios_name\"; prepare the device first." >&2; exit 1; }
    printf '%s\n' "$udid"
    exit 0
  fi
  app="${app:-$project_root/ios/build/Build/Products/Debug-iphonesimulator/mychampions.app}"
  [[ -d "$app" ]] || { echo "iOS app not found: $app" >&2; exit 1; }
  if [[ -z "$udid" ]]; then
    udid="$(xcrun simctl create "$ios_name" "${MAESTRO_IOS_DEVICE_TYPE:-iPhone 17}")"
    echo "Created simulator $ios_name ($udid)."
  fi
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  # Pin the language/region; a change only applies after a reboot.
  if [[ "$(xcrun simctl spawn "$udid" defaults read -g AppleLocale 2>/dev/null)" != "en_US" ]]; then
    xcrun simctl spawn "$udid" defaults write -g AppleLanguages -array en
    xcrun simctl spawn "$udid" defaults write -g AppleLocale -string en_US
    xcrun simctl shutdown "$udid"
    xcrun simctl boot "$udid"
    xcrun simctl bootstatus "$udid" -b >/dev/null
  fi
  # Password AutoFill clears typed create-account passwords and breaks
  # hierarchy reads on password screens; switch it off (idempotent).
  maestro_bin="$(bash "$project_root/scripts/testing/install-maestro.sh")"
  "$maestro_bin" --device "$udid" test "$project_root/.maestro/setup/ios-disable-password-autofill.yaml" >&2
  echo "Password AutoFill is off on simulator $udid."
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
  # Per-app languages (`cmd locale`) exist from Android 13 (API 33).
  api="$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
  if [[ ! "$api" =~ ^[0-9]+$ ]] || ((api < 33)); then
    echo "Android device $serial runs API ${api:-unknown}; the suite needs API 33+ (Android 13)" \
      "to pin the app language. Use an API 33+ emulator, such as the MyChampions_Maestro AVD" \
      "(API 37)." >&2
    exit 1
  fi
  # Every suite flow starts with `launchApp: clearState`, which runs `pm clear`;
  # that also deletes the per-app language set below, so flows render in the
  # system language. The system language must be en-US (an Android 14
  # regional-preference suffix such as -u-mu-celsius is fine).
  system_locale="$(adb -s "$serial" shell getprop persist.sys.locale | tr -d '\r')"
  [[ -n "$system_locale" ]] ||
    system_locale="$(adb -s "$serial" shell getprop ro.product.locale | tr -d '\r')"
  if [[ "$system_locale" != en-US && "$system_locale" != en-US-* ]]; then
    echo "Android device $serial uses system language ${system_locale:-unknown}; the suite needs" \
      "en-US because each flow's clearState (\`pm clear\`) drops the app's per-app language." \
      "Set the emulator to English (United States) in Settings > System > Languages." >&2
    exit 1
  fi
  adb -s "$serial" install -r -t "$app" >/dev/null
  echo "Installed $(basename "$app") on $serial."
  # Pin the installed app to en-US (applies until its data is cleared).
  adb -s "$serial" shell cmd locale set-app-locales "$android_app_id" --user current --locales en-US
  app_locales="$(adb -s "$serial" shell cmd locale get-app-locales "$android_app_id" --user current |
    tr -d '\r')"
  if [[ "$app_locales" != *" are [en-US]" ]]; then
    echo "Could not pin $android_app_id to en-US on $serial; get-app-locales reported:" \
      "${app_locales:-nothing}" >&2
    exit 1
  fi
  echo "Pinned $android_app_id to en-US on $serial."
else
  echo "Usage: $0 --platform ios|android [--app PATH | --resolve-only]" >&2
  exit 2
fi
