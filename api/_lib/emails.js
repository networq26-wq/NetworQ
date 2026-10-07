// Transactional email templates (react-email components, rendered without a JSX build step).
const React = require("react");
const { render: renderEmail } = require("@react-email/render");
const { Html, Head, Preview, Body, Container, Section, Heading, Text, Button, Hr, Link } = require("@react-email/components");

const h = React.createElement;
const BRAND = "#7C3AED";
const font = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial, sans-serif";

function Layout({ preview, heading, lines, cta, footnote, appUrl }) {
  return h(
    Html,
    { lang: "en" },
    h(Head),
    h(Preview, null, preview),
    h(
      Body,
      { style: { backgroundColor: "#F2F2F7", fontFamily: font, margin: 0, padding: "24px 0" } },
      h(
        Container,
        { style: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: "32px 28px", maxWidth: 520 } },
        h(Text, { style: { fontSize: 22, fontWeight: 800, color: "#1C1C1E", margin: "0 0 20px" } }, "Networ", h("span", { style: { color: BRAND } }, "Q")),
        h(Heading, { as: "h1", style: { fontSize: 22, color: "#1C1C1E", margin: "0 0 12px" } }, heading),
        ...lines.map((l, i) => h(Text, { key: i, style: { fontSize: 15, lineHeight: "24px", color: "#3C3C43", margin: "0 0 12px" } }, l)),
        cta &&
          h(
            Section,
            { style: { margin: "24px 0" } },
            h(Button, { href: cta.url, style: { backgroundColor: BRAND, color: "#FFFFFF", borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 600, textDecoration: "none" } }, cta.label)
          ),
        footnote && h(Text, { style: { fontSize: 13, color: "#6E6E73", margin: "0 0 8px" } }, footnote),
        h(Hr, { style: { borderColor: "#E5E5EA", margin: "24px 0 16px" } }),
        h(
          Text,
          { style: { fontSize: 12, color: "#8E8E93", margin: 0 } },
          "NetworQ — Professional Network Intelligence · ",
          h(Link, { href: `${appUrl}/?settings=notifications`, style: { color: "#8E8E93" } }, "Email settings"),
          " · ",
          h(Link, { href: `${appUrl}/privacy`, style: { color: "#8E8E93" } }, "Privacy")
        )
      )
    )
  );
}

const first = (name) => (name ? String(name).trim().split(/\s+/)[0] : "there");

function welcome({ name, appUrl, setPasswordUrl }) {
  const base = {
    subject: "Welcome to NetworQ",
    appUrl,
    preview: "Scan a card, join an event, never lose a connection.",
    heading: `Welcome, ${first(name)} 👋`,
    lines: [
      "Your NetworQ workspace is ready.",
      "Scan a business card to save a contact in seconds, set follow-up reminders, and open Event Radar at your next event to see who's nearby.",
    ],
    cta: { label: "Open NetworQ", url: appUrl },
  };
  if (!setPasswordUrl) return base;
  // Google sign-ups: offer a password via a one-time link — never send a password by email
  return {
    ...base,
    lines: [...base.lines, "You signed up with Google. If you'd also like to sign in with your email address and a password, set one now:"],
    cta: { label: "Set a password", url: setPasswordUrl },
    footnote: `This one-time link expires in 1 hour. You can also set a password any time in Settings → Security, or keep using Continue with Google. Open NetworQ: ${appUrl}`,
  };
}

function setPassword({ name, appUrl, setPasswordUrl }) {
  return {
    subject: "Set a password for NetworQ",
    appUrl,
    preview: "Sign in with your email too — one tap to set a password.",
    heading: `Set a password, ${first(name)}`,
    lines: [
      "You signed in to NetworQ with Google. Set a password and you can also sign in with your email address — handy on a new phone or a shared computer.",
    ],
    cta: { label: "Set a password", url: setPasswordUrl },
    footnote: `This one-time link expires in 1 hour. You can also set one any time in Me → Password & devices, or keep using Continue with Google. Open NetworQ: ${appUrl}`,
  };
}

function newSignIn({ name, device, when, city, secureUrl, appUrl = "https://www.networq.co.in" }) {
  return {
    subject: "New sign-in to your NetworQ account",
    appUrl,
    preview: `${device} · ${when}`,
    heading: "New sign-in detected",
    lines: [
      `Hi ${first(name)}, your account was just signed in from a new device.`,
      `Device: ${device}`,
      `Time: ${when}${city ? ` · Near ${city}` : ""}`,
      "If this was you, there's nothing to do.",
    ],
    cta: { label: "This wasn't me — secure my account", url: secureUrl },
    footnote: "Securing your account signs out every device and emails you a link to set a new password. The link works for 24 hours.",
  };
}

function passwordChanged({ name, when, secureUrl, appUrl = "https://www.networq.co.in" }) {
  return {
    subject: "Your NetworQ password was changed",
    appUrl,
    preview: `Changed ${when}`,
    heading: "Password changed",
    lines: [`Hi ${first(name)}, the password for your NetworQ account was changed on ${when}.`, "If you made this change, you can ignore this email."],
    cta: { label: "I didn't do this — secure my account", url: secureUrl },
  };
}

function deletionScheduled({ name, date, cancelUrl, appUrl = "https://www.networq.co.in" }) {
  return {
    subject: "Your NetworQ account is scheduled for deletion",
    appUrl,
    preview: `Deletion on ${date}`,
    heading: "Account deletion scheduled",
    lines: [
      `Hi ${first(name)}, we received a request to delete your NetworQ account.`,
      `Your account and all its data will be permanently deleted on ${date}. You've been signed out of all devices.`,
      "Changed your mind? Cancel any time before then.",
    ],
    cta: { label: "Cancel deletion", url: cancelUrl },
  };
}

function connectionRequest({ name, fromName, fromTitle, eventName, appUrl }) {
  return {
    subject: `${fromName} wants to connect on NetworQ`,
    appUrl,
    preview: eventName ? `You were both at ${eventName}` : "New connection request",
    heading: `${fromName} wants to connect`,
    lines: [
      `Hi ${first(name)}, ${fromName}${fromTitle ? ` (${fromTitle})` : ""} sent you a connection request${eventName ? ` at ${eventName}` : ""}.`,
      "Accept to swap contact details — nothing is shared until you do.",
    ],
    cta: { label: "Review request", url: `${appUrl}/?open=radar` },
  };
}

function connectionAccepted({ name, otherName, otherTitle, eventName, appUrl }) {
  return {
    subject: `${otherName} accepted your connection request`,
    appUrl,
    preview: "You're connected",
    heading: "You're connected 🎉",
    lines: [
      `Hi ${first(name)}, ${otherName}${otherTitle ? ` (${otherTitle})` : ""} accepted your request${eventName ? ` from ${eventName}` : ""}.`,
      "Their contact details are now in your NetworQ contacts.",
    ],
    cta: { label: "Open contacts", url: `${appUrl}/?open=contacts` },
  };
}

function waitlistConfirmation({ email, position, appUrl = "https://www.networq.co.in" }) {
  const num = position ? `#${position}` : "early access";
  return {
    subject: "You're on the NetworQ early access list 🎉",
    appUrl,
    preview: position ? `You're #${position} on the NetworQ waitlist.` : "Welcome to NetworQ early access.",
    heading: "You're on the early access list! 🎉",
    lines: [
      "Thank you for joining the NetworQ early access waitlist.",
      position
        ? `You have reserved spot ${num} in our priority queue.`
        : "Your spot in our priority queue is confirmed.",
      "NetworQ quietly remembers every connection, scans business cards into actionable contacts, and drafts intelligent follow-ups so you never lose momentum.",
      "We are onboarding members in waves to guarantee high-touch service and speed. We will send your personal invite link as soon as your access is active.",
    ],
    cta: { label: "Explore NetworQ", url: appUrl },
    footnote: "Thank you for supporting NetworQ — Professional Network Intelligence.",
  };
}

async function render(tpl) {
  const el = h(Layout, tpl);
  const [html, text] = await Promise.all([renderEmail(el), renderEmail(el, { plainText: true })]);
  return { subject: tpl.subject, html, text };
}

module.exports = { welcome, newSignIn, passwordChanged, deletionScheduled, connectionRequest, connectionAccepted, waitlistConfirmation, render, setPassword };
