// Calendar invite (RFC 5545, METHOD:REQUEST) so the recipient gets Accept / Decline in
// Gmail, Outlook and Apple Mail, and the meeting lands in their calendar.

export interface MeetingInvite {
  uid: string;
  start: Date;
  durationMinutes: number;
  title: string;
  description?: string;
  link?: string; // video link (Google Meet, Zoom, Teams, Jitsi…)
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const icsDate = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

// Text values escape \ ; , and newlines (RFC 5545 §3.3.11)
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Parameter values (CN) can't contain quotes or control characters
const cn = (s: string) => s.replace(/["\r\n]/g, "").slice(0, 80);

// Lines longer than 75 octets are folded with CRLF + space (§3.1)
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildInvite(m: MeetingInvite): string {
  const end = new Date(m.start.getTime() + m.durationMinutes * 60_000);
  const desc = [m.description, m.link ? `Join: ${m.link}` : ""].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NetworQ//Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${m.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(m.title)}`,
    desc ? `DESCRIPTION:${esc(desc)}` : "",
    m.link ? `LOCATION:${esc(m.link)}` : "",
    m.link ? `URL:${m.link}` : "",
    `ORGANIZER;CN="${cn(m.organizerName)}":mailto:${m.organizerEmail}`,
    `ATTENDEE;CN="${cn(m.attendeeName)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${m.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Meeting reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter(Boolean).map(fold).join("\r\n") + "\r\n";
}

// A video link must be a real https URL (Meet, Zoom, Teams, Webex, Jitsi, Whereby, …)
export function normaliseMeetingLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Free, no-account video room (Jitsi). The person who opens it first may be asked to sign in once.
export function jitsiRoom(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `https://meet.jit.si/NetworQ-${seg(4)}-${seg(4)}-${seg(4)}`;
}
