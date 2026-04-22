const jwt = require("jsonwebtoken");
const dayjs = require("dayjs");
const { query } = require("../config/db");
const { ROLES } = require("../config/constants");

function resolveJwtSecret() {
  const explicitSecret = String(process.env.JWT_SECRET || "").trim();
  if (explicitSecret) {
    return explicitSecret;
  }
  if (process.env.NODE_ENV !== "production") {
    return "iims-dev-insecure-secret-change-in-production";
  }
  return "";
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const queryToken = String(req.query?.token || "").trim();
  const headerToken = authHeader.startsWith("Bearer ")
    ? authHeader.substring("Bearer ".length)
    : authHeader;
  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ error: "Authentication token is required." });
  }

  try {
    const jwtSecret = resolveJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({
        error: "Server authentication secret is missing. Set JWT_SECRET in environment configuration."
      });
    }
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;

    if (!payload?.id || payload?.role === ROLES.SYSTEM_DEVELOPER) {
      return next();
    }

    return query(
      `SELECT password_last_changed_at, password_expires_at, must_change_password,
              DATEDIFF(password_expires_at, NOW()) AS days_remaining
       FROM users
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [payload.id, payload.institution_id]
    )
      .then((rows) => {
        if (!rows.length) return next();
        const row = rows[0];
        const expiry = row.password_expires_at ? dayjs(row.password_expires_at) : null;
        const daysRemaining = Number(row.days_remaining ?? NaN);
        if (expiry && expiry.isValid() && expiry.isBefore(dayjs())) {
          return res.status(403).json({
            error: "Password expired. Contact your administrator or system developer for reset.",
            password_policy: {
              expired: true,
              days_remaining: 0
            }
          });
        }
        req.passwordPolicy = {
          last_changed_at: row.password_last_changed_at || null,
          expires_at: row.password_expires_at || null,
          days_remaining: Number.isFinite(daysRemaining) ? daysRemaining : null,
          must_change_password: Number(row.must_change_password || 0) === 1,
          expired: false
        };
        req.user.password_last_changed_at = row.password_last_changed_at || null;
        req.user.password_expires_at = row.password_expires_at || null;
        req.user.must_change_password = Number(row.must_change_password || 0) === 1;
        return next();
      })
      .catch((error) => {
        return res.status(500).json({ error: "Authentication policy check failed.", details: error.message });
      });
  } catch (error) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
}

module.exports = { auth };
