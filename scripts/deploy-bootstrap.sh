#!/usr/bin/env bash
# rev57 — one-shot deploy bootstrap on a fresh Ubuntu 22.04+ VPS.
# Defaults target www.theimis.com / developer@theimis.com (Zoho).
#   curl -fsSL https://raw.githubusercontent.com/edwinkasienyo-ai/Kasienyo/cursor/rev57-theimis-zoho-2a2b/scripts/deploy-bootstrap.sh \
#     | bash -s -- www.theimis.com developer@theimis.com
set -euo pipefail
DOMAIN="${1:-www.theimis.com}"
ACME_EMAIL="${2:-developer@theimis.com}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <imis-domain> <admin-email>"
  exit 1
fi

echo "[1/8] Updating apt + installing docker, certbot, ufw..."
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw git certbot

# Install Docker Engine + Compose plugin from the official Docker repo so the
# 'docker compose' subcommand is always available (the Ubuntu repo no longer
# carries 'docker-compose-plugin' on noble 24.04).
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker

echo "[2/8] Firewalling 22, 80, 443 only..."
sudo ufw default deny incoming || true
sudo ufw default allow outgoing || true
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
yes | sudo ufw enable || true

PROJECT_DIR="${HOME}/imis"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  echo "[3/8] Cloning repo into $PROJECT_DIR ..."
  git clone https://github.com/edwinkasienyo-ai/Kasienyo.git "$PROJECT_DIR"
else
  echo "[3/8] Repo present, pulling..."
  ( cd "$PROJECT_DIR" && git pull --ff-only )
fi

cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
  echo "[4/8] Writing .env template (EDIT BEFORE STARTING containers)..."
  cat > .env <<EOF
NODE_ENV=production
PORT=5002
FORCE_HTTPS=true
ENABLE_CSP=true
IIMS_CSRF_ENABLED=true
IIMS_APPROVAL_GATE=true
IIMS_BUILD_STAMP=ui-deploy-rev57

JWT_SECRET=replace-with-random-32-char-secret
DB_HOST=db
DB_PORT=3306
DB_USER=imis_app
DB_PASS=replace-with-strong-db-pass
DB_NAME=iims_school_system
MYSQL_ROOT_PASSWORD=replace-with-stronger-root-pass
IMIS_DB_PASS=replace-with-strong-db-pass

# AI queue
IIMS_AI_QUEUE_BACKEND=redis
REDIS_URL=redis://redis:6379
AI_QUEUE_NAME=imis-ai

# OpenAI
OPENAI_API_KEY=

# === Zoho Mail (developer@theimis.com) ===
# Steps once: log into mail.zoho.com → Settings → Mail Accounts →
# IMAP/SMTP → "Generate App Password" → copy below.
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=developer@theimis.com
SMTP_PASS=zoho-app-password-paste-here
SMTP_FROM=IMIS <developer@theimis.com>

# Optional: Twilio Verify / SMS
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
TWILIO_VERIFY_SERVICE_SID=

# Optional: Africas Talking (cheaper SMS in Kenya)
AT_API_KEY=
AT_USERNAME=
AT_FROM=
EOF
  echo
  echo "    Edit $PROJECT_DIR/.env now (passwords, JWT_SECRET, OPENAI_API_KEY, SMTP, Twilio)."
  echo "    Press ENTER to continue once edited."
  read -r _
fi

echo "[5/8] Substituting your domain in the nginx config..."
sed -i "s|_yourdomain_|$DOMAIN|g" scripts/nginx-imis.conf

echo "[6/8] Bringing up the stack (without HTTPS yet so certbot can answer port 80)..."
sed -i 's|^  ssl_certificate|# tmp ssl_certificate|' scripts/nginx-imis.conf
sed -i 's|^  ssl_certificate_key|# tmp ssl_certificate_key|' scripts/nginx-imis.conf
mkdir -p scripts/letsencrypt scripts/letsencrypt-www logs uploads
sudo docker compose -f docker-compose.prod.yml up -d --build

echo "[7/8] Issuing TLS certificate via certbot http-01..."
sudo certbot certonly --webroot -w "$PROJECT_DIR/scripts/letsencrypt-www" \
  -d "$DOMAIN" --email "$ACME_EMAIL" --agree-tos --no-eff-email --non-interactive
sudo cp -L /etc/letsencrypt/live/$DOMAIN/fullchain.pem $PROJECT_DIR/scripts/letsencrypt/live/$DOMAIN/fullchain.pem 2>/dev/null || true
sudo cp -L /etc/letsencrypt/live/$DOMAIN/privkey.pem $PROJECT_DIR/scripts/letsencrypt/live/$DOMAIN/privkey.pem 2>/dev/null || true
sed -i 's|# tmp ssl_certificate|ssl_certificate|' scripts/nginx-imis.conf
sed -i 's|# tmp ssl_certificate_key|ssl_certificate_key|' scripts/nginx-imis.conf
sudo docker compose -f docker-compose.prod.yml restart nginx

echo "[8/8] Done. Site should be reachable at: https://$DOMAIN"
echo "  Health: https://$DOMAIN/api/health"
echo "  Logs:   docker logs -f imis_app"
