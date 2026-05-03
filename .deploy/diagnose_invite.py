"""Diagnose invite-flow bug on production CACP server.

Reads SSH credentials from docs/Server info.md, then on the production server:
  1. dumps redacted /etc/cacp/cacp.env so we can compare deploy-time vs.
     runtime config (token secret length, public origin, deployment mode);
  2. shows the live systemd service status and key environment;
  3. exercises the full invite roundtrip via 127.0.0.1:3737 (the same
     internal API the web frontend hits via Caddy):
        a. create a room -> get owner_token
        b. create an invite -> get invite_token
        c. GET /invites/verify?token=<invite_token> -> expect valid:true
        d. report each step's response
  4. additionally hits the public HTTPS endpoint to confirm the same flow
     works through Caddy (rules out a proxy/path issue);
  5. if verify returns valid:false, dumps the invites table contents
     plus the hash of the token computed with the runtime secret so we can
     see whether the create-time hash and the verify-time hash diverge.
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

echo "=== systemctl status (head) ==="
systemctl is-active cacp || true
systemctl show cacp -p MainPID,ActiveEnterTimestamp,ExecStart,EnvironmentFiles | sed 's/^/  /'

echo
echo "=== /etc/cacp/cacp.env (redacted) ==="
if [ -r /etc/cacp/cacp.env ]; then
  while IFS= read -r line; do
    if echo "$line" | grep -q '^CACP_TOKEN_SECRET='; then
      val="${line#CACP_TOKEN_SECRET=}"
      val="${val%\"}"
      val="${val#\"}"
      printf '  CACP_TOKEN_SECRET=<len=%s, sha256_first8=%s>\n' "${#val}" "$(printf '%s' "$val" | sha256sum | cut -c1-8)"
    elif echo "$line" | grep -qE '^[A-Z_]+='; then
      echo "  $line"
    fi
  done < /etc/cacp/cacp.env
else
  echo "  (cannot read /etc/cacp/cacp.env)"
fi

echo
echo "=== process env CACP_* (from systemd) ==="
PID=$(systemctl show cacp -p MainPID --value)
if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
  tr '\0' '\n' < "/proc/$PID/environ" | grep '^CACP_' | while IFS= read -r kv; do
    if echo "$kv" | grep -q '^CACP_TOKEN_SECRET='; then
      val="${kv#CACP_TOKEN_SECRET=}"
      printf '  CACP_TOKEN_SECRET=<len=%s, sha256_first8=%s>\n' "${#val}" "$(printf '%s' "$val" | sha256sum | cut -c1-8)"
    else
      echo "  $kv"
    fi
  done
else
  echo "  (cannot inspect process environment, PID=$PID)"
fi

echo
echo "=== invite roundtrip via 127.0.0.1:3737 ==="
ROOM_RESP=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"name":"diagnostic","display_name":"diag-owner"}' \
  http://127.0.0.1:3737/rooms)
echo "[1] POST /rooms -> $ROOM_RESP"
ROOM_ID=$(echo "$ROOM_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['room_id'])" 2>/dev/null || echo "")
OWNER=$(echo "$ROOM_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['owner_token'])" 2>/dev/null || echo "")

if [ -z "$ROOM_ID" ] || [ -z "$OWNER" ]; then
  echo "  (failed to create room; aborting)"
  exit 0
fi

INVITE_RESP=$(curl -sS -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" \
  -d '{"role":"member","expires_in_seconds":3600,"max_uses":1}' \
  "http://127.0.0.1:3737/rooms/$ROOM_ID/invites")
echo "[2] POST /rooms/$ROOM_ID/invites -> $INVITE_RESP"
TOKEN=$(echo "$INVITE_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['invite_token'])" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "  (failed to create invite; aborting)"
  exit 0
fi

echo "[3] invite_token (first 20 chars + length): $(printf '%s' "$TOKEN" | cut -c1-20)... len=${#TOKEN}"

VERIFY_LOCAL=$(curl -sS "http://127.0.0.1:3737/invites/verify?token=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$TOKEN")")
echo "[4] GET /invites/verify (127.0.0.1) -> $VERIFY_LOCAL"

VERIFY_PUBLIC=$(curl -sS "https://cacp.zuchongai.com/invites/verify?token=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$TOKEN")")
echo "[5] GET /invites/verify (public HTTPS via Caddy) -> $VERIFY_PUBLIC"

echo
echo "=== sqlite invites table snapshot ==="
sqlite3 /var/lib/cacp/cacp.db "SELECT invite_id, room_id, substr(token_hash,1,30)||'...' as token_hash_prefix, role, used_count, max_uses, revoked_at, expires_at FROM invites ORDER BY created_at DESC LIMIT 5;" 2>&1 | sed 's/^/  /'

echo
echo "=== last 30 server log lines (journal) ==="
journalctl -u cacp -n 30 --no-pager 2>&1 | tail -n 30 | sed 's/^/  /'
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
    server_info = parse_server_info(SERVER_INFO.read_text(encoding="utf-8-sig"))
    host = server_info.get("ip") or meta["server"]["ssh"]["host"]
    user = server_info.get("user") or meta["server"]["ssh"]["username"]
    password = server_info.get("password")
    port = int(meta["server"]["ssh"].get("port", 22))
    if not password:
        raise SystemExit("Missing SSH password")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("[ssh] connecting...")
    client.connect(host, port=port, username=user, password=password, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        sftp = client.open_sftp()
        try:
            with sftp.open("/tmp/diagnose-invite.sh", "w") as fh:
                fh.write(REMOTE_SCRIPT)
            sftp.chmod("/tmp/diagnose-invite.sh", 0o755)
        finally:
            sftp.close()

        rc = stream_command(client, "bash /tmp/diagnose-invite.sh")
        stream_command(client, "rm -f /tmp/diagnose-invite.sh")
        return rc
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
