const mysql = require("mysql2/promise");

const dbHost = process.env.DB_HOST || "127.0.0.1";
const dbUser = process.env.DB_USER || "root";
const dbPass = process.env.DB_PASS || "";
const dbName = process.env.DB_NAME || "iims_school_system";
const requestedPort = Number(process.env.DB_PORT || 3306);

let activePool = null;
let activePort = null;

function buildPoolConfig(port) {
  const useSsl =
    String(process.env.DB_SSL || "").trim().toLowerCase() === "true" ||
    String(process.env.DB_SSL || "").trim() === "1";
  return {
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: dbName,
    port: Number(port),
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    connectTimeout: Math.min(120000, Math.max(5000, Number(process.env.DB_CONNECT_TIMEOUT_MS || 30000))),
    ssl: useSsl ? {} : false
  };
}

/**
 * Docker MySQL often refuses connections until init finishes ("Connection lost" / ECONNRESET).
 */
async function waitForMysqlPool(port) {
  const attempts = Math.min(120, Math.max(5, Number(process.env.DB_CONNECT_ATTEMPTS || 35)));
  const gapMs = Math.min(5000, Math.max(300, Number(process.env.DB_CONNECT_RETRY_MS || 1500)));
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    const candidatePool = mysql.createPool(buildPoolConfig(port));
    try {
      await candidatePool.query("SELECT 1");
      if (process.env.NODE_ENV !== "production" && i > 0) {
        console.warn(`[IIMS][DB] MySQL on port ${port} became reachable after ${i + 1} attempt(s).`);
      }
      return candidatePool;
    } catch (err) {
      lastErr = err;
      try {
        await candidatePool.end();
      } catch (_) {
        // ignore pool close errors during backoff
      }
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  throw lastErr || new Error(`MySQL on port ${port} did not become ready after ${attempts} attempts.`);
}

async function resolvePool() {
  if (activePool) return activePool;

  const candidatePorts = [...new Set([requestedPort, 3307, 3306].filter((value) => Number.isFinite(value) && value > 0))];
  const errors = [];

  for (const port of candidatePorts) {
    try {
      const candidatePool = await waitForMysqlPool(port);
      activePool = candidatePool;
      activePort = port;
      if (port !== requestedPort) {
        console.warn(
          `[IIMS][DB] Requested DB_PORT=${requestedPort} unavailable. Connected using fallback port ${port}.`
        );
      }
      return activePool;
    } catch (error) {
      errors.push(`port ${port}: ${error.message}`);
    }
  }

  throw new Error(
    `Unable to connect to MySQL on ${dbHost}. Tried ports: ${candidatePorts.join(", ")}. ${errors.join(" | ")}`
  );
}

async function query(sql, params = []) {
  const pool = await resolvePool();
  const safeParams = Array.isArray(params)
    ? params.map((value) => {
      if (value === undefined) return null;
      if (typeof value === "number" && !Number.isFinite(value)) return 0;
      return value;
    })
    : [];
  const [rows] = await pool.execute(sql, safeParams);
  return rows;
}

module.exports = {
  get pool() {
    return activePool;
  },
  get activePort() {
    return activePort;
  },
  query
};
