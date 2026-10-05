import { test, expect } from "@playwright/test";
import { buildInvite, normaliseMeetingLink, jitsiRoom } from "../../meet/ics";

const base = {
  uid: "abc@networq.co.in",
  start: new Date(Date.UTC(2026, 9, 10, 4, 30)), // 10 Oct 2026 10:00 IST
  durationMinutes: 30,
  title: "Asha <> Ravi; intro, catch-up",
  description: "Agenda:\nPricing, timeline",
  link: "https://meet.google.com/abc-defg-hij",
  organizerName: 'Asha "AR" Rao',
  organizerEmail: "asha@acme.in",
  attendeeName: "Ravi Kumar",
  attendeeEmail: "ravi@kumar.in",
};

test("invite is a valid RFC 5545 REQUEST with UTC times, RSVP and the link", () => {
  const ics = buildInvite(base);
  const unfolded = ics.replace(/\r\n /g, ""); // RFC 5545 unfolding
  expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(ics).toContain("METHOD:REQUEST");
  expect(ics).toContain("DTSTART:20261010T043000Z");
  expect(ics).toContain("DTEND:20261010T050000Z");
  expect(ics).toContain(String.raw`SUMMARY:Asha <> Ravi\; intro\, catch-up`);
  expect(ics).toContain("LOCATION:https://meet.google.com/abc-defg-hij");
  expect(unfolded).toContain('ORGANIZER;CN="Asha AR Rao":mailto:asha@acme.in');
  expect(unfolded).toMatch(/ATTENDEE;CN="Ravi Kumar";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ravi@kumar\.in/);
  expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  // every physical line is at most 75 octets (long lines folded)
  for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
});

test("meeting links: https only, bare domains get https, junk rejected", () => {
  expect(normaliseMeetingLink("meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
  expect(normaliseMeetingLink("https://us02web.zoom.us/j/123?pwd=x")).toBe("https://us02web.zoom.us/j/123?pwd=x");
  expect(normaliseMeetingLink("http://evil.test")).toBeNull();
  expect(normaliseMeetingLink("javascript:alert(1)")).toBeNull();
  expect(normaliseMeetingLink("not a link")).toBeNull();
  expect(normaliseMeetingLink("")).toBeNull();
  expect(jitsiRoom()).toMatch(/^https:\/\/meet\.jit\.si\/NetworQ-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
});
