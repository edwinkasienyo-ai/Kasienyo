const jwt = require("jsonwebtoken");
const dayjs = require("dayjs");
const { query } = require("../config/db");
const { ROLES } = require("../config/constants");

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring("Bearer ".length)
    : authHeader;

  if (!token) {
    return res.status(401).json({ error: "Authentication token is required." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;

    if (!payload?.id || payload?.role === ROLES.SYSTEM_DEVELOPER) {
      return next();
    }

    return query(
      `SELECT password_expires_at, DATEDIFF(password_expires_at, NOW()) AS days_remaining
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
          expires_at: row.password_expires_at || null,
          days_remaining: Number.isFinite(daysRemaining) ? daysRemaining : null,
          expired: false
        };
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
