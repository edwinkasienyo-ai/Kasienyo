# AGENTS.md

## Cursor Cloud specific instructions

### Overview

IIMS (Integrated Information Management System) is a monolithic Node.js/Express application for managing Kenyan basic education schools. It serves a static HTML/CSS/JS frontend from `public/` and a REST API from `src/`. The single entry point is `src/server.js`.

### Services

| Service | Required | How to run |
|---------|----------|------------|
| MySQL 8 | Yes | `sudo mysqld --user=mysql --datadir=/var/lib/mysql &` (wait ~3s for socket) |
| Node.js Express app | Yes | `npm run dev` (port 5002, uses nodemon for hot reload) |

### Running the app

1. Ensure MySQL is running and the `iims_school_system` database exists.
2. Copy `.env.example` to `.env` if not already done. Default values work for local dev with `OTP_CHANNEL=console`.
3. Run `npm run dev` — the server starts on port 5002.
4. The app auto-runs schema migrations on startup (`src/server.js` idempotently creates/alters tables).
5. Default login: username `admin`, password `1234`. OTP codes are printed to the server console when `OTP_CHANNEL=console`.

### Key gotchas

- **MySQL socket**: After starting `mysqld` in the background, wait 3-5 seconds for `/var/run/mysqld/mysqld.sock` to appear before running mysql commands or starting the app.
- **No linter or test suite**: The project has no ESLint config and no automated test framework. The only check is `npm run check` which runs `node --check` on three source files (syntax-only validation).
- **Schema auto-migration**: `src/server.js` runs extensive idempotent `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` migrations on startup, so importing `sql/schema.sql` once is sufficient — the app will add any missing columns/tables.
- **OTP in dev**: With `OTP_CHANNEL=console` (the default), OTP codes appear in server stdout as `[OTP] email -> CODE (channel=console)`.
- **Port conflict**: By default `IIMS_PORT_FALLBACK=0`, so the app exits if port 5002 is busy instead of silently hopping to another port.
- **No build step**: The frontend is vanilla HTML/CSS/JS served from `public/`; there is no transpilation or bundling step.
