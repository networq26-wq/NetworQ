const https = require("https");
const http = require("http");
const { URL } = require("url");
const { isAllowedOrigin } = require("./_lib/cors");

function cleanText(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function fetchHtml(targetUrl, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === "http:" ? http : https;
      const req = client.get(
        parsed,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).href;
            return fetchHtml(redirectUrl, timeoutMs).then(resolve).catch(reject);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
            if (data.length > 500000) {
              req.destroy();
              resolve(data);
            }
          });
          res.on("end", () => resolve(data));
        }
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

function parseMetadata(html, originUrl) {
  const parsed = new URL(originUrl);
  const domain = parsed.hostname.replace(/^www\./, "");

  const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i) ||
    html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = cleanText(titleMatch ? titleMatch[1] : domain);

  const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i) ||
    html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
  const description = cleanText(descMatch ? descMatch[1] : "");

  const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
  let image = imgMatch ? imgMatch[1].trim() : "";
  if (image && !image.startsWith("http")) {
    image = new URL(image, originUrl).href;
  }

  const linkedinMatch = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+)["']/i);
  const linkedin = linkedinMatch ? linkedinMatch[1] : "";

  const twitterMatch = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-zA-Z0-9_]+)["']/i);
  const twitter = twitterMatch ? twitterMatch[1] : "";

  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

  return {
    domain,
    title,
    description,
    image,
    logo: favicon,
    linkedin,
    twitter,
  };
}

module.exports = async function enrichHandler(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin, process.env.ALLOWED_ORIGIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const queryUrl = req.query?.url || req.body?.url || req.body?.domain || req.query?.domain;
  if (!queryUrl) {
    return res.status(400).json({ error: "Missing url or domain parameter." });
  }

  let formatted = queryUrl.trim();
  if (!formatted.startsWith("http://") && !formatted.startsWith("https://")) {
    formatted = "https://" + formatted;
  }

  try {
    const html = await fetchHtml(formatted);
    const meta = parseMetadata(html, formatted);
    return res.json({ ok: true, data: meta });
  } catch (err) {
    const fallbackDomain = formatted.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "");
    return res.json({
      ok: true,
      data: {
        domain: fallbackDomain,
        title: fallbackDomain.charAt(0).toUpperCase() + fallbackDomain.slice(1),
        description: "",
        image: "",
        logo: `https://www.google.com/s2/favicons?domain=${fallbackDomain}&sz=128`,
        linkedin: "",
        twitter: "",
      },
      warning: `Live scrape note: ${err.message}`,
    });
  }
};
