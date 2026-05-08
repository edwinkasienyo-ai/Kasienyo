# AGENTS.md

## Cursor Cloud specific instructions

### Overview

IIMS (Integrated Information Management System) is a monolithic Node.js + Express + MySQL web app for Kenyan basic learning institutions. A single process serves the REST API and static frontend (`public/`). There is no build step; frontend is vanilla HTML/CSS/JS.

### Prerequisites

- **Node.js 20+** (runtime)
- **MySQL 8.x** (must be running on `127.0.0.1:3306` with root user, empty password)

### Starting MySQL

MySQL is not auto-started. Before running the app:

```bash
sudo mysqld --user=mysql --datadir=/var/lib/mysql &
sleep 3
```

Verify: `mysql -u root -h 127.0.0.1 -e "SELECT 1"`

### Starting the dev server

```bash
npm run dev
```

Server runs on `http://localhost:5002` (uses nodemon for auto-reload).

### Default login

- Username: `admin`, Password: `1234`
- OTP channel is set to `console` in `.env` — OTP codes appear in the server terminal output. Look for `[OTP] ... -> XXXXXX` in the nodemon output.

### Syntax check (no linter/test suite configured)

```bash
npm run check
```

This runs `node --check` on the main JS files. There are no automated test suites or ESLint configuration in this project.

### Key gotchas

- The app auto-migrates DB columns on startup (`src/server.js` has extensive `ensureUserPasswordPolicyColumns`). No manual migration step is needed.
- `.env` is created from `.env.example`; `DB_PASS` should be empty for local dev.
- The DB connection code (`src/config/db.js`) tries ports 3306, 3307, and whatever `DB_PORT` is set to, with auto-fallback.
- `IIMS_PORT_FALLBACK=0` (default) means the app exits if port 5002 is busy rather than silently hopping to 5003.
- Login flow: POST `/api/auth/login` → get OTP from console → POST `/api/auth/verify-otp` → JWT token.
