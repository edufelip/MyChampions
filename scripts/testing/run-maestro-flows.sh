#!/usr/bin/env bash
# Run the Maestro flows of one suite folder that carry one fixture tag.
#
#   scripts/testing/run-maestro-flows.sh --platform ios|android --tag TAG \
#     [--output DIR] [--retries N] FLOW_DIR
#
# Metro must already serve the bundle built with the tag's fixture env (the
# selective executor starts it). A failing run is retried up to --retries times
# (default 1) and the retry is reported, so a flaky pass stays visible. With
# CI_REQUIRE_E2E_EXECUTION=true a folder with no flow for the tag fails.
set -euo pipefail

platform=""
tag=""
output=""
retries=1
flow_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) platform="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --retries) retries="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) flow_dir="$1"; shift ;;
  esac
done
[[ "$platform" == ios || "$platform" == android ]] || { echo "--platform ios|android is required" >&2; exit 2; }
[[ -n "$tag" && -d "$flow_dir" ]] || { echo "--tag and an existing FLOW_DIR are required" >&2; exit 2; }
[[ "$retries" =~ ^[0-9]+$ ]] || { echo "--retries must be a non-negative integer" >&2; exit 2; }

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

tagged="$({ grep -lE "^tags: \[(.*, )?${tag}(, .*)?\]$" "$flow_dir"/*.yaml 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [[ "$tagged" -eq 0 ]]; then
  if [[ "${CI_REQUIRE_E2E_EXECUTION:-}" == "true" ]]; then
    echo "No flow in $flow_dir is tagged $tag; refusing an empty native run." >&2
    exit 1
  fi
  echo "No flow in $flow_dir is tagged $tag; nothing to run."
  exit 0
fi

device="$(bash "$project_root/scripts/testing/maestro-device.sh" --platform "$platform" --resolve-only)"
output="${output:-$project_root/.artifacts/maestro/$platform/$(basename "$flow_dir")-$tag}"
mkdir -p "$output"

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

attempt=0
while true; do
  attempt=$((attempt + 1))
  attempt_dir="$output/attempt-$attempt"
  mkdir -p "$attempt_dir"
  echo "Maestro $platform $(basename "$flow_dir") [$tag]: $tagged flow(s), attempt $attempt."
  if maestro --device "$device" test \
    --include-tags "$tag" \
    --format junit \
    --output "$attempt_dir/report.xml" \
    --test-output-dir "$attempt_dir" \
    "$flow_dir"; then
    if [[ "$attempt" -gt 1 ]]; then
      echo "::warning::Maestro $(basename "$flow_dir") [$tag] passed only on attempt $attempt (flaky)."
    fi
    exit 0
  fi
  if [[ "$attempt" -gt "$retries" ]]; then
    echo "Maestro $(basename "$flow_dir") [$tag] failed after $attempt attempt(s); see $output." >&2
    exit 1
  fi
done
