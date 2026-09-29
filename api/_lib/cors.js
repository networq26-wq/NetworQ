function isAllowedOrigin(origin, allowListCsv) {
  if (!origin || !allowListCsv) return false;
  const allowList = allowListCsv.split(",").map(s => s.trim()).filter(Boolean);
  return allowList.includes(origin);
}

module.exports = { isAllowedOrigin };

