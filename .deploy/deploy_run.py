"""Local deployment driver for CACP cloud server.

Reads SSH credentials from docs/Server info.md and metadata from
.deploy/aliyun-server.local.json, packages tracked files plus the connector
exe into a tar.gz, uploads it via SFTP, executes a remote script that
rebuilds and swaps the release, and resets the SQLite database before the
service starts again.
"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import paramiko

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_META = REPO_ROOT / ".deploy" / "aliyun-server.local.json"
SERVER_INFO = REPO_ROOT / "docs" / "Server info.md"
CONNECTOR_REL = "packages/web/public/downloads/CACP-Local-Connector.exe"

EXCLUDES = {
    "docs/Server info.md",
    "docs/deploy-cloud.md",
}
EXCLUDE_PREFIXES = (
    ".deploy/",
)


def parse_server_info(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip().rstrip(",")
        m = re.match(r"^(\w+)\s*=\s*\"(.*)\"$", line)
        if m:
            fields[m.group(1)] = m.group(2)
    return fields


def commit_short() -> str:
    out = subprocess.check_output(
        ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, text=True
    ).strip()
    return out


def git_tracked_files() -> list[str]:
    out = subprocess.check_output(
        ["git", "ls-files"], cwd=REPO_ROOT, text=True
    ).splitlines()
    return [p.strip() for p in out if p.strip()]


def should_include(path: str) -> bool:
    if path in EXCLUDES:
        return False
    return not any(path.startswith(prefix) for prefix in EXCLUDE_PREFIXES)


def build_archive(commit: str, ts: str) -> Path:
    archive = REPO_ROOT / ".deploy" / f"cacp-{commit}-{ts}.tar.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        archive.unlink()

    files: list[str] = [p for p in git_tracked_files() if should_include(p)]
    connector_path = REPO_ROOT / CONNECTOR_REL
    if not connector_path.is_file() or connector_path.stat().st_size == 0:
        raise SystemExit(f"Missing or empty connector exe: {connector_path}")

    print(f"[pack] {len(files)} tracked files + connector exe -> {archive.name}")
    with tarfile.open(archive, "w:gz") as tar:
        for rel in files:
            full = REPO_ROOT / rel
            if not full.exists():
                # Tracked file that does not exist in the working tree: skip.
                continue
            tar.add(full, arcname=rel, recursive=False)
        tar.add(connector_path, arcname=CONNECTOR_REL, recursive=False)
    return archive


REMOTE_SCRIPT_TEMPLATE = """#!/usr/bin/env bash
set -euo pipefail

ARCHIVE={archive_remote}
RELEASE_DIR=/opt/cacp-releases/cacp-{ts}-{commit}
BACKUP_DIR=/opt/cacp-backups/cacp-{ts}-{commit}
APP_DIR=/opt/cacp
SERVICE=cacp
DB_PATH=/var/lib/cacp/cacp.db

echo "[remote] PWD: $(pwd)"
echo "[remote] RELEASE_DIR: $RELEASE_DIR"
echo "[remote] ARCHIVE exists: $(test -f "$ARCHIVE" && echo YES || echo NO)"

mkdir -p /opt/cacp-releases /opt/cacp-backups /var/lib/cacp
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
echo "[remote] After cd: $(pwd)"

corepack enable
corepack prepare pnpm@9.15.4 --activate
export PATH=/opt/rh/gcc-toolset-11/root/usr/bin:$PATH
export LD_LIBRARY_PATH=/opt/rh/gcc-toolset-11/root/usr/lib64:${{LD_LIBRARY_PATH:-}}

corepack pnpm install --frozen-lockfile
corepack pnpm --filter @cacp/protocol build
corepack pnpm --filter @cacp/server build:prod
VITE_CACP_DEPLOYMENT_MODE=cloud corepack pnpm --filter @cacp/web build

test -f packages/server/dist/index.js
test -f packages/web/dist/index.html
test -s packages/web/dist/downloads/CACP-Local-Connector.exe

echo "[remote] Build OK; stopping service for swap..."

systemctl stop "$SERVICE" || true

if [ -d "$APP_DIR" ]; then
  rm -rf "$BACKUP_DIR"
  mv "$APP_DIR" "$BACKUP_DIR"
fi
mv "$RELEASE_DIR" "$APP_DIR"
chown -R cacp:cacp "$APP_DIR"

systemctl start "$SERVICE"
sleep 3
curl -fsS http://127.0.0.1:3737/health | tee /tmp/cacp-health.json
echo
systemctl reload caddy || systemctl restart caddy

rm -f "$ARCHIVE"
echo "[remote] Deployment complete"
"""


def render_remote_script(archive_remote: str, commit: str, ts: str) -> str:
    return REMOTE_SCRIPT_TEMPLATE.format(
        archive_remote=archive_remote,
        commit=commit,
        ts=ts,
    )


def stream_command(client: paramiko.SSHClient, command: str) -> int:
    stdin, stdout, stderr = client.exec_command(command, get_pty=False)
    stdin.close()
    channel = stdout.channel
    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode("utf-8", errors="replace")
            if chunk:
                sys.stdout.write(chunk)
                sys.stdout.flush()
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(4096).decode("utf-8", errors="replace")
            if chunk:
                sys.stderr.write(chunk)
                sys.stderr.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        time.sleep(0.05)
    return channel.recv_exit_status()


def main() -> int:
    if not DEPLOY_META.is_file():
        raise SystemExit(f"Missing {DEPLOY_META}")
    if not SERVER_INFO.is_file():
        raise SystemExit(f"Missing {SERVER_INFO}")

    meta = json.loads(DEPLOY_META.read_text(encoding="utf-8-sig"))
    server_info = parse_server_info(SERVER_INFO.read_text(encoding="utf-8-sig"))

    host = server_info.get("ip") or meta["server"]["ssh"]["host"]
    user = server_info.get("user") or meta["server"]["ssh"]["username"]
    password = server_info.get("password")
    port = int(meta["server"]["ssh"].get("port", 22))
    if not password:
        raise SystemExit("Missing SSH password in docs/Server info.md")

    commit = commit_short()
    ts = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    print(f"[plan] commit={commit} ts={ts}")

    archive = build_archive(commit, ts)
    archive_size = archive.stat().st_size
    print(f"[pack] archive size: {archive_size} bytes")

    archive_remote = f"/tmp/cacp-{commit}-{ts}.tar.gz"
    remote_script_path = "/tmp/deploy-remote.sh"
    remote_script = render_remote_script(archive_remote, commit, ts)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[ssh] connecting host=*** port={port} user=***")
    client.connect(host, port=port, username=user, password=password, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        sftp = client.open_sftp()
        try:
            print(f"[sftp] uploading archive -> {archive_remote}")
            sftp.put(str(archive), archive_remote)
            print(f"[sftp] uploading remote script -> {remote_script_path}")
            with sftp.open(remote_script_path, "w") as fh:
                fh.write(remote_script)
            sftp.chmod(remote_script_path, 0o755)
        finally:
            sftp.close()

        print("[ssh] executing remote deployment script")
        rc = stream_command(client, f"bash {remote_script_path}")
        if rc != 0:
            print(f"[ssh] remote script exit code: {rc}", file=sys.stderr)
            return rc

        # Cleanup the remote temp script
        stream_command(client, f"rm -f {remote_script_path}")
    finally:
        client.close()

    # Local cleanup of generated archive
    try:
        archive.unlink()
        print(f"[cleanup] removed local {archive}")
    except OSError:
        pass

    print("[done] deployment finished successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
