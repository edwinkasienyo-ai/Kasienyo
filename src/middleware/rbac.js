const { ROLE_PERMISSIONS } = require("../config/constants");

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    const expandedAllowed = new Set(roles);
    if (expandedAllowed.has("SYSTEM_DEVELOPER")) {
      expandedAllowed.add("SUPER_SYSTEM_DEVELOPER");
    }
    if (!req.user || !expandedAllowed.has(role)) {
      return res.status(403).json({ error: "Role not allowed." });
    }
    return next();
  };
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    const role = req.user?.role;
    const rolePermissions = ROLE_PERMISSIONS[role] || [];
    const hasPermission = permissions.every((permission) =>
      rolePermissions.includes(permission)
    );

    if (!hasPermission) {
      return res.status(403).json({ error: "Permission denied." });
    }
    return next();
  };
}

module.exports = { requireRole, requirePermission };
