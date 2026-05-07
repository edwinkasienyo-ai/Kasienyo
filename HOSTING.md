# IMIS Hosting Guide (rev46)

## TL;DR — one-shot Hostinger VPS deploy

After provisioning a fresh Ubuntu 22.04 VPS and pointing `theimis.com`
DNS at its IPv4 address, SSH in as root and run:

```bash
apt update && apt install -y git
git clone -b cursor/launch-day-rev46-3b70 \
  https://github.com/edwinkasienyo-ai/Kasienyo.git /opt/imis
cd /opt/imis
IMIS_DOMAIN=theimis.com \
IMIS_ADMIN_EMAIL=mwendeguenterpriseltd@gmail.com \
  bash scripts/ubuntu-vps-bootstrap.sh
```

That single script:
- installs Node 20, MySQL 8, nginx, certbot, ufw, fail2ban
- creates a dedicated `imis` UNIX user
- provisions the database, generates secure passwords, imports schema
- writes `/opt/imis/.env` with placeholders for SendGrid + Africa's Talking keys
- starts the app under PM2 (auto-restart on reboot)
- configures nginx with HTTPS-redirect + reverse proxy
- issues a Let's Encrypt cert for `theimis.com` + `www.theimis.com`
- locks down the firewall (22/80/443 only)

After it finishes, the only manual step is to edit `/opt/imis/.env`,
paste the SendGrid + AT keys, and run `sudo -u imis pm2 restart imis`.

The rest of this document covers manual steps and the older deployment paths.

---


This file documents a production deployment of IMIS (Integrated Management Information System for Basic Learning Institutions).

## 1. Minimum requirements

- Node.js **20.x** LTS
- MySQL **8.x** (or compatible MariaDB 10.11+)
- At least **1 GB RAM**, **10 GB disk** for uploads + DB + logs
- Outbound HTTPS to Twilio Verify (`verify.twilio.com`) and your SMTP relay

## 2. Environment variables

Copy `.env.example` to `.env` and set:

```
NODE_ENV=production
PORT=5002
FORCE_HTTPS=true                 # redirect http -> https when behind proxy
ENABLE_CSP=true                  # strict CSP headers
IIMS_BUILD_STAMP=ui-deploy-revXX # visible on /api/build-info

JWT_SECRET=<32+ random chars>
JWT_EXPIRES_IN=1d

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=imis_app
DB_PASS=<strong>
DB_NAME=iims_school_system

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=imis-mail@yourdomain
SMTP_PASS=<app password>
SMTP_FROM="IMIS <imis-mail@yourdomain>"

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...                # for raw SMS fallback
TWILIO_VERIFY_SERVICE_SID=VA...  # preferred for login OTP
```

## 3. Deployment paths

### 3a. PM2 on a Linux VM (simplest)

```bash
sudo apt update && sudo apt install -y nodejs npm mysql-server nginx
git clone <repo> /opt/imis && cd /opt/imis
cp .env.example .env && vi .env
npm ci --omit=dev
mysql -u root -p -e "CREATE DATABASE iims_school_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p iims_school_system < sql/schema.sql
mkdir -p logs uploads
sudo npm i -g pm2
pm2 start ecosystem.config.js
pm2 startup systemd && pm2 save
```

Then configure **nginx** as TLS terminator:

```nginx
server {
  listen 443 ssl http2;
  server_name imis.yourdomain.co.ke;
  ssl_certificate     /etc/letsencrypt/live/imis.yourdomain.co.ke/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/imis.yourdomain.co.ke/privkey.pem;

  client_max_body_size 25M;

  location / {
    proxy_pass http://127.0.0.1:5002;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
server {
  listen 80;
  server_name imis.yourdomain.co.ke;
  return 301 https://$host$request_uri;
}
```

### 3b. Docker + Compose

```bash
docker compose up --build -d
docker compose logs -f imis
```

### 3c. Windows / on-premise

Use the included `scripts/windows-auto-setup.ps1` (developer workstations only, not production).

## 4. Backups

Cron the DB backup:

```
0 2 * * *  /opt/imis/scripts/backup-db.sh >> /var/log/imis-backup.log 2>&1
```

Uploads directory: snapshot `/opt/imis/uploads` daily (rsync, restic, or cloud bucket sync).

## 5. Operations sanity checks

After deploy, verify:

- `https://<host>/api/build-info` → `build_stamp` matches expected release.
- `https://<host>/api/health` → `{"status":"ok"}`.
- `https://<host>/api/health/messaging` → `smtp_configured: true`, `twilio_verify_configured: true` (or `twilio_sms_configured: true`).
- System Developer login works, OTP is received, audit log appears in Security & Logging Audit.
- HSTS header present on responses (`Strict-Transport-Security`).

## 6. Rollback

Every deploy carries a visible revision marker:

- HTML comment `STEP1_IDX_REV=NN` in the login page source.
- `CLIENT_UI_BUNDLE_ID` in `public/dashboard.js`.
- `IIMS_BUILD_STAMP` returned from `/api/build-info`.

To roll back, check out the previous tag/branch, `pm2 restart imis`, then re-verify the three markers match.
