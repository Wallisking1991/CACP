"""Patch /etc/caddy/Caddyfile on the production server to proxy /invites*.

Steps performed remotely:
  1. read current Caddyfile, abort if it already contains an `/invites*` handle
  2. write new Caddyfile to a temp path with the new block inserted right
     after the existing `/agent-pairings*` handle block
  3. run `caddy validate --config <tmp>` to confirm syntax
  4. snapshot the live file to /etc/caddy/Caddyfile.bak-<ts>
  5. atomically move tmp -> /etc/caddy/Caddyfile and `systemctl reload caddy`
  6. on any failure, restore from the snapshot and reload again
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import paramiko

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_META = REPO_ROOT / ".deploy" / "aliyun-server.local.json"
SERVER_INFO = REPO_ROOT / "docs" / "Server info.md"


def parse_server_info(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip().rstrip(",")
        m = re.match(r"^(\w+)\s*=\s*\"(.*)\"$", line)
        if m:
            fields[m.group(1)] = m.group(2)
    return fields


REMOTE_SCRIPT = r"""#!/usr/bin/env bash
set -uo pipefail

CADDYFILE=/etc/caddy/Caddyfile
TS=$(date -u +%Y%m%d%H%M%S)
BACKUP="${CADDYFILE}.bak-${TS}"
TMP=$(mktemp /tmp/Caddyfile.new.XXXXXX)

if [ ! -f "$CADDYFILE" ]; then
  echo "[abort] $CADDYFILE missing"
  exit 1
fi

if grep -qE 'handle\s+/invites\*' "$CADDYFILE"; then
  echo "[skip] /invites* handle already present, no change needed"
  exit 0
fi

if ! grep -qE 'handle\s+/agent-pairings\*' "$CADDYFILE"; then
  echo "[abort] anchor '/agent-pairings*' block not found, refusing to guess insertion point"
  exit 2
fi

# Insert a new `handle /invites* { reverse_proxy 127.0.0.1:3737 }` block
# immediately after the agent-pairings handle's closing brace at base indent.
# We use awk to track brace depth inside the agent-pairings block so we don't
# trip on the outer `cacp.zuchongai.com {` braces.
awk '
  BEGIN { state=0; depth=0 }
  {
    print $0
    if (state == 0 && $0 ~ /handle[[:space:]]+\/agent-pairings\*/) { state=1 }
    if (state == 1) {
      # count braces on this line
      tmp=$0
      gsub(/[^{]/, "", tmp); depth += length(tmp)
      tmp=$0
      gsub(/[^}]/, "", tmp); depth -= length(tmp)
      if (depth == 0 && $0 ~ /\}/) {
        print ""
        print "    handle /invites* {"
        print "        reverse_proxy 127.0.0.1:3737"
        print "    }"
        state=2
      }
    }
  }
' "$CADDYFILE" > "$TMP"

if ! grep -qE 'handle\s+/invites\*' "$TMP"; then
  echo "[abort] insertion did not produce an /invites* handle"
  rm -f "$TMP"
  exit 3
fi

echo "=== diff (current vs new) ==="
diff -u "$CADDYFILE" "$TMP" || true

echo
echo "=== caddy validate ==="
if ! caddy validate --config "$TMP" --adapter caddyfile; then
  echo "[abort] caddy validate failed; not touching live config"
  rm -f "$TMP"
  exit 4
fi

cp -p "$CADDYFILE" "$BACKUP"
echo "[backup] $BACKUP"
mv "$TMP" "$CADDYFILE"
chmod 644 "$CADDYFILE"

echo
echo "=== systemctl reload caddy ==="
if ! systemctl reload caddy; then
  echo "[error] reload failed, restoring backup"
  cp -p "$BACKUP" "$CADDYFILE"
  systemctl reload caddy || systemctl restart caddy || true
  exit 5
fi

systemctl is-active caddy
echo
echo "=== final Caddyfile ==="
cat "$CADDYFILE"
"""


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
    meta = json.loads(DEPLOY_META.read_text(encoding="utf-8-sig"))
    info = parse_server_info(SERVER_INFO.read_text(encoding="utf-8-sig"))
    host = info.get("ip") or meta["server"]["ssh"]["host"]
    user = info.get("user") or meta["server"]["ssh"]["username"]
    pwd = info.get("password")
    port = int(meta["server"]["ssh"].get("port", 22))
    if not pwd:
        raise SystemExit("Missing SSH password")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("[ssh] connecting...")
    c.connect(host, port=port, username=user, password=pwd, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        sftp = c.open_sftp()
        try:
            with sftp.open("/tmp/patch-caddy-invites.sh", "w") as fh:
                fh.write(REMOTE_SCRIPT)
            sftp.chmod("/tmp/patch-caddy-invites.sh", 0o755)
        finally:
            sftp.close()
        rc = stream_command(c, "bash /tmp/patch-caddy-invites.sh")
        stream_command(c, "rm -f /tmp/patch-caddy-invites.sh")
        return rc
    finally:
        c.close()


if __name__ == "__main__":
    sys.exit(main())
