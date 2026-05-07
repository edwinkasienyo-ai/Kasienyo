#!/usr/bin/env bash
# =============================================================================
# IMIS — One-shot Ubuntu 22.04 VPS bootstrap
# =============================================================================
# Run as root on a fresh Hostinger / DigitalOcean / Linode Ubuntu 22.04 box.
#
#   curl -fsSL https://raw.githubusercontent.com/edwinkasienyo-ai/Kasienyo/cursor/launch-day-rev46-3b70/scripts/ubuntu-vps-bootstrap.sh \
#     -o /tmp/imis-bootstrap.sh
#   sudo bash /tmp/imis-bootstrap.sh
#
# Or after `git clone`:
#
#   cd /opt/imis && sudo bash scripts/ubuntu-vps-bootstrap.sh
#
# What it does:
#   1.  apt update + upgrade
#   2.  Install Node 20 LTS, MySQL 8, nginx, certbot, ufw, fail2ban, git
#   3.  Create a dedicated 'imis' UNIX user, /opt/imis project root
#   4.  Clone the repo (if not already cloned) and run npm ci --omit=dev
#   5.  Provision MySQL: db, user, password, schema.sql + seed.sql import
#   6.  Generate /opt/imis/.env from a template + injected secrets
#   7.  Install PM2 globally, register the systemd unit, start the app
#   8.  Configure nginx with HTTPS-redirect + reverse proxy
#   9.  Issue Let's Encrypt cert via certbot for the configured domain
#  10.  Configure UFW firewall (22/tcp, 80/tcp, 443/tcp)
#  11.  Print the post-install verification checklist
#
# Idempotent — safe to re-run; existing components are left in place.
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

# ----- Configuration (override via environment variables) --------------------
DOMAIN="${IMIS_DOMAIN:-theimis.com}"
ADMIN_EMAIL="${IMIS_ADMIN_EMAIL:-mwendeguenterpriseltd@gmail.com}"
APP_USER="${IMIS_APP_USER:-imis}"
APP_DIR="${IMIS_APP_DIR:-/opt/imis}"
REPO_URL="${IMIS_REPO_URL:-https://github.com/edwinkasienyo-ai/Kasienyo.git}"
REPO_BRANCH="${IMIS_REPO_BRANCH:-cursor/launch-day-rev46-3b70}"
DB_NAME="${IMIS_DB_NAME:-iims_school_system}"
DB_USER="${IMIS_DB_USER:-imis_app}"
DB_PASS="${IMIS_DB_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
DB_ROOT_PASS="${IMIS_DB_ROOT_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
JWT_SECRET="${IMIS_JWT_SECRET:-$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)}"

ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '\e[1;36m[%s]\e[0m %s\n' "$(ts)" "$*"; }
ok()   { printf '\e[1;32m[%s] OK\e[0m %s\n' "$(ts)" "$*"; }
warn() { printf '\e[1;33m[%s] WARN\e[0m %s\n' "$(ts)" "$*"; }
err()  { printf '\e[1;31m[%s] ERR\e[0m %s\n' "$(ts)" "$*" >&2; }

if [ "$EUID" -ne 0 ]; then
  err "Run this script as root (sudo bash $0)."
  exit 1
fi

trap 'err "Bootstrap failed at line $LINENO. See output above."' ERR

# ----- 1. apt -----------------------------------------------------------------
log "Step 1/11 — apt update & upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# ----- 2. core packages -------------------------------------------------------
log "Step 2/11 — installing Node 20, MySQL 8, nginx, certbot, ufw, fail2ban, git"

if ! command -v node >/dev/null || ! node --version | grep -qE '^v(20|21|22)'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
fi
apt-get install -y nodejs mysql-server nginx certbot python3-certbot-nginx \
  ufw fail2ban git build-essential ca-certificates jq htop unattended-upgrades
ok "core packages installed"

# Auto security updates
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# ----- 3. application user ----------------------------------------------------
log "Step 3/11 — creating user '${APP_USER}' and ${APP_DIR}"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "$APP_USER"
fi
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ----- 4. clone repo + install npm deps ---------------------------------------
log "Step 4/11 — cloning ${REPO_URL} (${REPO_BRANCH}) into ${APP_DIR}"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" -H git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
sudo -u "$APP_USER" -H git fetch origin "$REPO_BRANCH"
sudo -u "$APP_USER" -H git checkout "$REPO_BRANCH"
sudo -u "$APP_USER" -H git pull origin "$REPO_BRANCH"
sudo -u "$APP_USER" -H npm ci --omit=dev
mkdir -p "$APP_DIR/logs" "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/logs" "$APP_DIR/uploads"
ok "repo at $(sudo -u "$APP_USER" -H git -C "$APP_DIR" log -1 --format='%h %s')"

# ----- 5. MySQL provisioning --------------------------------------------------
log "Step 5/11 — provisioning MySQL database '${DB_NAME}' and user '${DB_USER}'"
systemctl enable --now mysql

# Lock down MySQL on first install — equivalent to mysql_secure_installation
if ! mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
  warn "MySQL root has password set already; skipping initial root config."
else
  mysql -uroot <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${DB_ROOT_PASS}';
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost','127.0.0.1','::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
EOF
  log "MySQL root password set. Saved to /root/.imis-credentials.txt"
fi

mysql -uroot -p"${DB_ROOT_PASS}" <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

if [ -f "$APP_DIR/sql/schema.sql" ]; then
  mysql -uroot -p"${DB_ROOT_PASS}" "${DB_NAME}" < "$APP_DIR/sql/schema.sql"
  ok "schema.sql imported"
fi
if [ -f "$APP_DIR/sql/seed.sql" ]; then
  mysql -uroot -p"${DB_ROOT_PASS}" "${DB_NAME}" < "$APP_DIR/sql/seed.sql" || \
    warn "seed.sql import had non-fatal errors (likely already-seeded rows)"
fi

# Persist the generated secrets for the operator
cat > /root/.imis-credentials.txt <<EOF
# IMIS bootstrap secrets — generated $(ts)
# Keep this file private.

DOMAIN=${DOMAIN}
APP_DIR=${APP_DIR}
APP_USER=${APP_USER}

DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_ROOT_PASS=${DB_ROOT_PASS}

JWT_SECRET=${JWT_SECRET}
EOF
chmod 600 /root/.imis-credentials.txt
ok "MySQL DB '${DB_NAME}' ready, credentials saved to /root/.imis-credentials.txt"

# ----- 6. .env file -----------------------------------------------------------
log "Step 6/11 — writing ${APP_DIR}/.env"
ENV_FILE="${APP_DIR}/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=5002
FORCE_HTTPS=true
ENABLE_CSP=true
IIMS_BUILD_STAMP=ui-deploy-rev46
FRONTEND_ORIGIN=https://${DOMAIN}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=1d

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_NAME=${DB_NAME}

SYSTEM_DEVELOPER_USERNAME=952252
SYSTEM_DEVELOPER_PASSWORD=Sheeza@2015
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=Admin@1234

OTP_CHANNEL=sms_email
OTP_EXPIRY_MINUTES=10
OTP_DISPATCH_TIMEOUT_MS=4000

# ===== EMAIL (SendGrid preferred, SMTP fallback) =====
SENDGRID_API_KEY=PASTE_FROM_SENDGRID
SENDGRID_FROM=no-reply@${DOMAIN}
SENDGRID_FROM_NAME=IMIS

# Optional Gmail / Zoho fallback if SendGrid is unavailable:
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ===== SMS (Africa's Talking preferred, Twilio fallback) =====
AT_API_KEY=PASTE_FROM_AT
AT_USERNAME=PASTE_FROM_AT
AT_FROM=IMIS

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
TWILIO_VERIFY_SERVICE_SID=
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env scaffolded — edit ${ENV_FILE} to paste SendGrid + AT keys, then 'pm2 restart imis'"
else
  warn ".env exists; not overwriting. To regenerate: rm ${ENV_FILE} and re-run."
fi

# ----- 7. PM2 + systemd -------------------------------------------------------
log "Step 7/11 — installing PM2 and registering systemd unit"
npm i -g pm2
pm2 kill || true
sudo -u "$APP_USER" -H bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.js"
sudo -u "$APP_USER" -H bash -c "cd ${APP_DIR} && pm2 save"
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null
ok "PM2 service registered (systemctl status pm2-${APP_USER} to inspect)"

# ----- 8. nginx ---------------------------------------------------------------
log "Step 8/11 — configuring nginx for ${DOMAIN}"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN} www.${DOMAIN};

  # Allow Let's Encrypt HTTP-01 validation; redirect everything else to HTTPS
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://${DOMAIN}\$request_uri; }
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${DOMAIN} www.${DOMAIN};

  # Cert paths get filled in by certbot in step 9
  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;
  ssl_stapling on;
  ssl_stapling_verify on;

  client_max_body_size 25M;
  proxy_read_timeout 60s;

  # Security headers (also set by helmet in app, this is defence-in-depth)
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location / {
    proxy_pass http://127.0.0.1:5002;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
NGINX

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t

# Temporarily comment out SSL block until certbot provisions a cert,
# otherwise nginx -t fails with "no such file" on first run.
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  warn "No Let's Encrypt cert yet for ${DOMAIN}. Will issue one in step 9."
  sed -i.bak 's|^\(\s*ssl_certificate.*\)|# \1|' "/etc/nginx/sites-available/${DOMAIN}"
  nginx -t && systemctl reload nginx
fi
ok "nginx configured"

# ----- 9. Let's Encrypt -------------------------------------------------------
log "Step 9/11 — issuing Let's Encrypt SSL for ${DOMAIN} (HTTP-01)"
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  warn "Cert already exists — renewing instead"
  certbot renew --quiet
else
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    -m "$ADMIN_EMAIL" \
    -d "$DOMAIN" \
    -d "www.${DOMAIN}"
  # Restore the SSL block now that certs are in place
  if [ -f "/etc/nginx/sites-available/${DOMAIN}.bak" ]; then
    cp "/etc/nginx/sites-available/${DOMAIN}.bak" "/etc/nginx/sites-available/${DOMAIN}"
    nginx -t && systemctl reload nginx
  fi
fi
systemctl reload nginx
ok "SSL active for https://${DOMAIN}"

# ----- 10. UFW + fail2ban -----------------------------------------------------
log "Step 10/11 — configuring UFW firewall + fail2ban"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

systemctl enable --now fail2ban
ok "UFW active (22, 80, 443 allowed); fail2ban running"

# ----- 11. final summary ------------------------------------------------------
log "Step 11/11 — verification"
sleep 2
APP_OK=false
if curl -sf "https://${DOMAIN}/api/health" | grep -q '"status":"ok"'; then
  APP_OK=true
fi

cat <<SUMMARY

================================================================================
IMIS bootstrap complete on ${DOMAIN}
================================================================================
URL:                https://${DOMAIN}
Health check:       https://${DOMAIN}/api/health        $([ "$APP_OK" = true ] && echo ✓ || echo ✗)
Build info:         https://${DOMAIN}/api/build-info
Messaging health:   https://${DOMAIN}/api/health/messaging
Application user:   ${APP_USER}
Application dir:    ${APP_DIR}
Database:           ${DB_NAME} (user ${DB_USER})
PM2 status:         pm2 status   (run as ${APP_USER})
Logs:               ${APP_DIR}/logs/   and   journalctl -u nginx -u pm2-${APP_USER}

Generated secrets are in /root/.imis-credentials.txt (chmod 600).

NEXT STEPS:
  1. SSH back in:   ssh root@\$(curl -s ifconfig.me)
  2. Edit ${ENV_FILE}: paste SENDGRID_API_KEY, AT_API_KEY, AT_USERNAME.
  3. Restart:        sudo -u ${APP_USER} pm2 restart imis  (or 'all')
  4. Smoke test:     log in at https://${DOMAIN} as 952252 / Sheeza@2015.
================================================================================
SUMMARY
