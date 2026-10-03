// vCard 3.0 for the Digital Pass QR: any phone camera can save it as a contact.
// Also parses vCards (and the older NetworQ JSON payload) when a pass is scanned.

export interface PassProfile {
  name: string;
  title?: string;
  company?: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

export function buildVCard(p: PassProfile): string {
  const name = (p.name || "").trim() || "NetworQ member";
  const [first, ...rest] = name.split(/\s+/);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(rest.join(" "))};${esc(first)};;;`,
    `FN:${esc(name)}`,
    p.company && `ORG:${esc(p.company)}`,
    p.title && `TITLE:${esc(p.title)}`,
    p.email && `EMAIL;TYPE=INTERNET:${p.email.trim()}`,
    p.phone && `TEL;TYPE=CELL:${p.phone.trim()}`,
    p.website && `URL:${p.website.trim()}`,
    p.linkedin && `X-SOCIALPROFILE;TYPE=linkedin:${p.linkedin.trim()}`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

// Returns the known profile fields from a scanned QR, or null if it isn't a contact
export function parseContactQr(text: string): Record<string, string> | null {
  const raw = String(text || "").trim();
  if (/^BEGIN:VCARD/i.test(raw)) {
    const out: Record<string, string> = {};
    // Unfold continuation lines (RFC 6350 §3.2)
    for (const line of raw.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i).split(";")[0].toUpperCase();
      const val = unesc(line.slice(i + 1)).trim().slice(0, 300);
      if (!val) continue;
      if (key === "FN") out.name = val;
      else if (key === "N" && !out.name) out.name = val.split(";").slice(0, 2).reverse().join(" ").trim();
      else if (key === "ORG") out.company = val.split(";")[0];
      else if (key === "TITLE") out.title = val;
      else if (key === "EMAIL" && !out.email) out.email = val;
      else if (key === "TEL" && !out.phone) out.phone = val;
      else if (key === "URL" && !out.website) out.website = val;
      else if (key === "X-SOCIALPROFILE" && /linkedin/i.test(line.slice(0, i) + val)) out.linkedin = val;
    }
    return out.name ? out : null;
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const out: Record<string, string> = {};
    for (const k of ["name", "title", "company", "email", "phone", "website", "linkedin"]) {
      if (typeof data[k] === "string") out[k] = data[k].slice(0, 300);
    }
    return out.name ? out : null;
  } catch {
    return null;
  }
}
