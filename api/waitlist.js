const fs   = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'waitlist.html'),
    'utf8'
  );

  const injected = html
    .replace("'REPLACE_WITH_YOUR_SUPABASE_URL'",      `'${process.env.EXPO_PUBLIC_SUPABASE_URL}'`)
    .replace("'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'", `'${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}'`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(injected);
};
