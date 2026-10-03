#!/usr/bin/env node
// Serves preview/index.html (device frames around the live Expo dev app). Dev only.
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = Number(process.env.PREVIEW_PORT || 8090);
const file = path.join(__dirname, "../preview/index.html");
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`📱 Device preview: http://localhost:${PORT}`));
