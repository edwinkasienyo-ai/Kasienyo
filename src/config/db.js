const mysql = require("mysql2/promise");

const dbHost = process.env.DB_HOST || "127.0.0.1";
const dbUser = process.env.DB_USER || "root";
const dbPass = process.env.DB_PASS || process.env.DB_PASSWORD || "";
const dbName = process.env.DB_NAME || "iims_school_system";
const requestedPort = Number(process.env.DB_PORT || 3306);

let activePool = null;
let activePort = null;

function buildPoolConfig(port) {
  return {
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: dbName,
    port: Number(port),
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0
  };
}

async function resolvePool() {
  if (activePool) return activePool;

  const candidatePorts = [...new Set([requestedPort, 3307, 3306].filter((value) => Number.isFinite(value) && value > 0))];
  const errors = [];

  for (const port of candidatePorts) {
    const candidatePool = mysql.createPool(buildPoolConfig(port));
    try {
      await candidatePool.query("SELECT 1");
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
      try {
        await candidatePool.end();
      } catch (_) {
        // Ignore pool close failures during fallback attempts.
      }
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
