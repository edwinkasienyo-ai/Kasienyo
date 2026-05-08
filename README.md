# INTEGRATED INFORMATION MANAGEMENT SYSTEM (IIMS)

Modern, secure, and scalable multi-tenant web system for basic learning institutions.

## Implemented Scope

This codebase includes a full baseline implementation for all requested sections:

1. **System overview and multi-tenant architecture**
2. **Modern responsive UI**
3. **Default administrator login (`admin` / `1234`) with change credentials**
4. **Authentication, RBAC permissions and OTP-based 2FA**
5. **Role-based portal support**
6. **Secure login requirements and OTP channels**
7. **Authorization and permissions**
8. **Real-time style dashboard summary**
9. **Search/filter and export foundation**
10. **Admission module**
11. **Management module**
12. **Academic module**
13. **HR module**
14. **Finance module**
15. **Communication module**
16. **Parents portal module**
17. **Staff welfare module**
18. **Laws, regulations and policies module**

## Tech Stack

- Node.js + Express
- MySQL 8+
- Static HTML/CSS/JS frontend
- JWT Auth + OTP + RBAC
- PDF + Excel exports

## Project Structure

```txt
public/
  index.html
  dashboard.html
  styles.css
  main.js
  dashboard.js
src/
  app.js
  server.js
  config/
  middleware/
  services/
  utils/
sql/
  schema.sql
  seed.sql
```

## Installation (NPM + MySQL)

### 1) Install dependencies

```bash
npm install
```

### 2) Create environment file

```bash
cp .env.example .env
```

Update `.env` values if needed (DB host/port/user/password/JWT secret/OTP channel).

### 3) Create MySQL database and schema

```bash
mysql -u root -p < sql/schema.sql
mysql -u root -p < sql/seed.sql
```

### 4) Run server

```bash
npm run dev
```

Open (default `PORT` in `.env.example` is **5002**, not 5000):
- Login: `http://localhost:5002/`
- Dashboard: `http://localhost:5002/dashboard.html`

## Windows: dashboard stuck on `dash-bundle-rev45` or Git refuses `pull/checkout`

Usually **one or both**:

1. **Uncommitted edits** to `public/dashboard.js` — Git warns *would be overwritten* and stays on **old JS** while `index.html` updates.
2. **Two Node processes**: one stays on `:5002` (older in-memory bundle), another runs on `:5003` — the browser/bookmark wins the wrong tab.

Fix in one shot from the repo root (`BASIC EDUCATION`, where `package.json` lives):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-force-sync-repo.ps1
npm install
npm start
```

By default **`IIMS_PORT_FALLBACK`** is OFF: if `:5002` is busy, **`npm start` exits** with instructions unless you set **`IIMS_PORT_FALLBACK=1`** in `.env`. That prevents “silent jump” to `:5003` during local development.

Manual equivalent (minimal):

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
git stash push -u -m "backup"
git checkout main
git fetch origin; git reset --hard origin/main
npm install && npm start
```

After **`npm start`**, use **exactly** the **URL:** line from that window. Hard-refresh the dashboard with **Ctrl+F5**. Static assets are served with **`Cache-Control: no-store`**; if the fingerprint string stays old, **the disk file is old** — run the sync script again.

## One-Command Auto Setup (Windows)

Use this when you want setup and startup fully automated in VS Code terminal.

```powershell
npm run autofix:win
```

Optional: set the login page photo while running setup.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-auto-setup.ps1 -HeroImagePath "C:\path\to\photo.jpg"
```

What it does:
- Pull latest `cursor/iims-full-system-2a2b`
- Ensure `.env` values for local run (port, DB host/port/user/name, frontend origin, build stamp)
- Install dependencies
- Import `sql/schema.sql` and `sql/seed.sql` when `mysql` CLI exists in PATH
- Start `npm run dev`

If Git is missing on Windows, the script now automatically falls back to downloading the latest branch ZIP and syncing the project files.

## Default Login

- **Username:** `admin`
- **Password:** `1234`

The server auto-creates the default institution and administrator on startup if missing.

## Roles Implemented

- Administrator
- Head of Institution
- MoD
- TSC
- Teacher
- Parent
- Non-teaching staff
- Board of Management (BOM)
- Learner

## Exports

Available export endpoints include:
- PDF
- Excel

The UI and metadata also include allowed format labels for:
PDF, Excel, Word, PNG, JPEG/JPG, RAW, HEIC/HEIF, TIFF, WEBP, PowerPoint and other Microsoft Office formats.

## Notes

- OTP channels supported: `console`, `email`, `sms` (configure in `.env`)
- Parent login fallback:
  - username: learner birth certificate number
  - password: parent ID number from learner biodata
- Learner login fallback:
  - username: UPI or Assessment number or Birth certificate number
  - default password: `1234` (can be changed by setting learner password hash in the system)
