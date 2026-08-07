#!/usr/bin/env bash

set -euo pipefail

runner_root="${MYCHAMPIONS_WEB_RUNNER_ROOT:-$HOME/actions-runner-mychampions-web-ci}"
runner_name="${MYCHAMPIONS_WEB_RUNNER_NAME:-mychampions-web-ci-ubuntu}"
runner_labels="${MYCHAMPIONS_WEB_RUNNER_LABELS:-mychampions-ci,mychampions-web-only}"
runner_work="${MYCHAMPIONS_WEB_RUNNER_WORK:-_work-web}"
runner_service="${MYCHAMPIONS_WEB_RUNNER_SERVICE:-mychampions-web-ci.service}"
repository_url="${GITHUB_SERVER_URL:?GITHUB_SERVER_URL is required}/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

if [ -e "$runner_root" ] && [ ! -d "$runner_root" ]; then
  echo "Runner root exists but is not a directory: $runner_root" >&2
  exit 1
fi

mkdir -p "$runner_root"
runner_root="$(cd "$runner_root" && pwd)"
runner_exec="/usr/bin/env -u ACTIONS_RUNNER_HOOK_JOB_STARTED -u ACTIONS_RUNNER_HOOK_JOB_COMPLETED -u MYCHAMPIONS_NATIVE_STATE_ROOT $runner_root/run.sh"

if [ ! -f "$runner_root/.runner" ]; then
  : "${ACTIONS_RUNNER_REGISTRATION_TOKEN:?ACTIONS_RUNNER_REGISTRATION_TOKEN is required for first-time configuration}"

  if [ -n "$(find "$runner_root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "Refusing to configure a non-empty unregistered runner directory: $runner_root" >&2
    exit 1
  fi

  release_json="$(mktemp)"
  archive_path="$(mktemp)"
  staging_root="$(mktemp -d "${runner_root}.bootstrap.XXXXXX")"
  cleanup_bootstrap() {
    rm -f "$release_json" "$archive_path"
    if [ -n "${staging_root:-}" ] && [ -d "$staging_root" ]; then
      rm -rf -- "$staging_root"
    fi
  }
  trap cleanup_bootstrap EXIT

  curl -fsSL https://api.github.com/repos/actions/runner/releases/latest > "$release_json"
  version="$(node - "$release_json" <<'NODE'
const fs = require("fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (typeof release.tag_name !== "string") process.exit(1);
process.stdout.write(release.tag_name.replace(/^v/, ""));
NODE
)"
  archive_name="actions-runner-linux-x64-${version}.tar.gz"
  asset_metadata="$(node - "$release_json" "$archive_name" <<'NODE'
const fs = require("fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const asset = release.assets?.find((candidate) => candidate.name === process.argv[3]);
if (!asset || typeof asset.browser_download_url !== "string" || typeof asset.digest !== "string") {
  process.exit(1);
}
process.stdout.write(`${asset.browser_download_url}\t${asset.digest}`);
NODE
)"
  IFS=$'\t' read -r asset_url asset_digest <<< "$asset_metadata"

  if [ -z "$version" ] || [ "$version" = "null" ] || [ -z "$asset_url" ] || [ "$asset_url" = "null" ]; then
    echo "Could not resolve the latest Linux x64 Actions runner release." >&2
    exit 1
  fi
  if [[ ! "$asset_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "The Actions runner release did not publish a SHA-256 digest for $archive_name." >&2
    exit 1
  fi

  curl -fsSL "$asset_url" > "$archive_path"
  echo "${asset_digest#sha256:}  $archive_path" | sha256sum --check --status
  tar -xzf "$archive_path" -C "$staging_root"

  (
    cd "$staging_root"
    ./config.sh \
      --unattended \
      --url "$repository_url" \
      --token "$ACTIONS_RUNNER_REGISTRATION_TOKEN" \
      --name "$runner_name" \
      --labels "$runner_labels" \
      --work "$runner_work" \
      --replace
  )

  find "$staging_root" -mindepth 1 -maxdepth 1 -exec mv -t "$runner_root" -- {} +
  rmdir "$staging_root"
  staging_root=""
fi

if sudo -n true 2>/dev/null; then
  (
    system_service_path="/etc/systemd/system/$runner_service"
    system_service_file="$(mktemp)"
    trap 'rm -f "$system_service_file"' EXIT
    cat > "$system_service_file" <<EOF
[Unit]
Description=GitHub Actions Runner ($runner_name)
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
ExecStart=$runner_exec
WorkingDirectory=$runner_root
Restart=always
RestartSec=5
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
    sudo -n install -m 0644 "$system_service_file" "$system_service_path"
    sudo -n systemctl daemon-reload
    sudo -n systemctl enable --now "$runner_service"
    sudo -n systemctl is-active --quiet "$runner_service"
    sudo -n systemctl status --no-pager "$runner_service"
  )
elif command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  user_service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  user_service_path="$user_service_dir/$runner_service"
  mkdir -p "$user_service_dir"
  cat > "$user_service_path" <<EOF
[Unit]
Description=GitHub Actions Runner ($runner_name)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$runner_exec
WorkingDirectory=$runner_root
Restart=always
RestartSec=5
KillMode=process

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$runner_service"
  systemctl --user is-active --quiet "$runner_service"
  systemctl --user status --no-pager "$runner_service"
else
  runner_pid_file="$runner_root/.mychampions-web-ci.pid"
  runner_log="$runner_root/_diag/mychampions-web-ci.log"
  runner_pid=""

  detached_runner_is_active() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] \
      && kill -0 "$pid" 2>/dev/null \
      && grep -Eaq "(Runner.Listener|run-helper\\.sh|/run\\.sh)" "/proc/$pid/cmdline"
  }

  if [ -f "$runner_pid_file" ]; then
    runner_pid="$(cat "$runner_pid_file")"
  fi

  if detached_runner_is_active "$runner_pid"; then
    echo "Detached web validation runner is already active with PID $runner_pid."
    exit 0
  fi

  rm -f "$runner_pid_file"
  mkdir -p "$runner_root/_diag"
  (
    cd "$runner_root"
    nohup env \
      -u RUNNER_TRACKING_ID \
      -u ACTIONS_RUNNER_HOOK_JOB_STARTED \
      -u ACTIONS_RUNNER_HOOK_JOB_COMPLETED \
      -u MYCHAMPIONS_NATIVE_STATE_ROOT \
      setsid ./run.sh >> "$runner_log" 2>&1 </dev/null &
    echo "$!" > "$runner_pid_file"
  )

  sleep 3
  runner_pid="$(cat "$runner_pid_file")"
  if ! detached_runner_is_active "$runner_pid"; then
    echo "Detached web validation runner failed to stay active. Recent log output:" >&2
    tail -n 50 "$runner_log" >&2
    exit 1
  fi
  echo "Detached web validation runner started with PID $runner_pid."
fi
