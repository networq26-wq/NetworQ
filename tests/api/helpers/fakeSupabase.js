// Tiny in-memory stand-in for the supabase-js query builder (select/insert/update with eq/order/limit).
function createFakeSupabase(tables = {}) {
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let seq = 0;
  function from(table) {
    db[table] = db[table] || [];
    const q = { filters: [], op: "select", payload: null, order: null, limit: null, wantSelect: false };
    const run = () => {
      let rows = db[table].filter((r) => q.filters.every(([k, v]) => r[k] === v));
      if (q.op === "insert") {
        const items = [].concat(q.payload).map((p) => ({ id: `id-${++seq}`, created_at: new Date().toISOString(), ...p }));
        db[table].push(...items);
        rows = items;
      } else if (q.op === "update") {
        rows.forEach((r) => Object.assign(r, q.payload));
      }
      if (q.order) rows = [...rows].sort((a, b) => (a[q.order.col] > b[q.order.col] ? 1 : -1) * (q.order.asc ? 1 : -1));
      if (q.limit) rows = rows.slice(0, q.limit);
      return rows;
    };
    const api = {
      select() { q.wantSelect = true; return api; },
      insert(p) { q.op = "insert"; q.payload = p; return api; },
      update(p) { q.op = "update"; q.payload = p; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order(col, o = {}) { q.order = { col, asc: o.ascending !== false }; return api; },
      limit(n) { q.limit = n; return api; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r[0] || null, error: null }); },
      single() { const r = run(); return Promise.resolve(r[0] ? { data: r[0], error: null } : { data: null, error: { message: "not found" } }); },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return api;
  }
  return { from, db };
}
module.exports = { createFakeSupabase };
