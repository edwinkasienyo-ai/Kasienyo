function buildSearchWhere({ fields = [], queryValue, params = [] }) {
  if (!queryValue || !fields.length) {
    return { where: "", params };
  }

  const pattern = `%${queryValue}%`;
  const clauses = fields.map((field) => `${field} LIKE ?`);
  const searchParams = fields.map(() => pattern);
  return {
    where: ` AND (${clauses.join(" OR ")})`,
    params: [...params, ...searchParams]
  };
}

module.exports = { buildSearchWhere };
