import { test, expect } from "@playwright/test";
import { buildVCard, parseContactQr } from "../../pass/vcard";

test("pass vCard is standard 3.0, escapes separators and round-trips", () => {
  const v = buildVCard({ name: "Asha Rao", title: "Founder, CEO", company: "Acme; Labs", email: "asha@acme.in", phone: "+91 90000 11111", linkedin: "https://linkedin.com/in/asha" });
  expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
  expect(v).toContain("N:Rao;Asha;;;");
  expect(v).toContain("TITLE:Founder\\, CEO");
  expect(v).toContain("ORG:Acme\\; Labs");
  expect(parseContactQr(v)).toEqual({ name: "Asha Rao", title: "Founder, CEO", company: "Acme; Labs", email: "asha@acme.in", phone: "+91 90000 11111", linkedin: "https://linkedin.com/in/asha" });
});

test("hidden fields are left out of the QR", () => {
  const v = buildVCard({ name: "Asha Rao", email: "", phone: "" });
  expect(v).not.toMatch(/EMAIL|TEL/);
});

test("scanner reads other vCards, folded lines and the legacy NetworQ JSON; rejects non-contacts", () => {
  expect(parseContactQr("BEGIN:VCARD\nVERSION:3.0\nN:Iyer;Bob\nTEL;TYPE=WORK:+1 555\nEMAIL:bob@\n x.io\nEND:VCARD")).toEqual({ name: "Bob Iyer", phone: "+1 555", email: "bob@x.io" });
  expect(parseContactQr(JSON.stringify({ name: "Cara", email: "c@x.io", evil: { a: 1 } }))).toEqual({ name: "Cara", email: "c@x.io" });
  expect(parseContactQr("https://example.com")).toBeNull();
  expect(parseContactQr(JSON.stringify({ email: "no-name@x.io" }))).toBeNull();
});
