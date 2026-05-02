#!/usr/bin/env bash
# Simple MySQL backup script for IMIS. Drop into cron, e.g.:
#   0 2 * * *  /opt/imis/scripts/backup-db.sh >> /var/log/imis-backup.log 2>&1
set -euo pipefail

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=3306}"
: "${DB_USER:=root}"
: "${DB_PASS:=}"
: "${DB_NAME:=iims_school_system}"
: "${BACKUP_DIR:=/var/backups/imis}"
: "${RETAIN_DAYS:=14}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/imis-$TS.sql.gz"

MYSQLDUMP_ARGS=(--host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER"
  --single-transaction --routines --triggers --events --default-character-set=utf8mb4
  "$DB_NAME")

if [[ -n "$DB_PASS" ]]; then
  MYSQL_PWD="$DB_PASS" mysqldump "${MYSQLDUMP_ARGS[@]}" | gzip -9 > "$OUT"
else
  mysqldump "${MYSQLDUMP_ARGS[@]}" | gzip -9 > "$OUT"
fi

find "$BACKUP_DIR" -type f -name "imis-*.sql.gz" -mtime +"$RETAIN_DAYS" -delete
echo "$(date -Iseconds) IMIS backup -> $OUT"
