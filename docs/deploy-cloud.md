# Cloud Room Server Deployment

This guide deploys the CACP cloud room server on Debian 12.

## Prerequisites

- Debian 12.10+ server
- Root or sudo access
- Domain `cacp.zuchongai.com` pointing to the server

## Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

## Enable Corepack and install pnpm

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Install Caddy

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install caddy
```

## Create directories

```bash
mkdir -p /opt/cacp
mkdir -p /var/lib/cacp
mkdir -p /etc/cacp
```

## Copy source code

Copy the repository to `/opt/cacp`:

```bash
# From your local machine:
rsync -avz --exclude=node_modules --exclude=.git --exclude=dist ./ root@cacp.zuchongai.com:/opt/cacp/
```

## Install dependencies and build

```bash
cd /opt/cacp
corepack pnpm install
corepack pnpm --filter @cacp/protocol build
corepack pnpm --filter @cacp/server build:prod
VITE_CACP_DEPLOYMENT_MODE=cloud corepack pnpm --filter @cacp/web build
```

## Configure environment

```bash
cp deploy/cacp.env.example /etc/cacp/cacp.env
# Edit and set a real CACP_TOKEN_SECRET:
nano /etc/cacp/cacp.env
```

Generate a secure token secret:

```bash
openssl rand -base64 48
```

## Create service user

```bash
useradd --system --home /opt/cacp --shell /bin/false cacp
chown -R cacp:cacp /opt/cacp
chown -R cacp:cacp /var/lib/cacp
```

## Install systemd service

```bash
cp deploy/cacp.service /etc/systemd/system/cacp.service
systemctl daemon-reload
systemctl enable cacp.service
systemctl start cacp.service
```

## Install Caddy config

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

## Smoke test

```bash
curl -fsS https://cacp.zuchongai.com/health
```

Expected response:

```json
{"ok":true,"protocol":"cacp","version":"0.2.0"}
```

## Browser verification

1. Open `https://cacp.zuchongai.com`
2. Create a room
3. Confirm the page shows a Local Connector command
4. Copy an invite link and join from a second browser profile
5. Send messages across both profiles
6. Claim a pairing through a local connector and confirm Agent online status
