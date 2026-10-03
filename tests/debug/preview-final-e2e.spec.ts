import { test, expect, type FrameLocator, type Page } from "@playwright/test";

// Final two-user end-to-end run against the LIVE backend, in the device preview:
// Person A (iPhone frame, preview.a) and Person B (Pixel frame, preview.b), Android-app mode with
// the simulated Bluetooth shell. Each step is logged with timing so the report can cite it.
test.setTimeout(900_000);

const steps: { n: number; name: string; ms: number; ok: boolean; note?: string }[] = [];
async function step(n: number, name: string, fn: () => Promise<string | void>) {
  const t = Date.now();
  try {
    const note = await fn();
    steps.push({ n, name, ms: Date.now() - t, ok: true, note: note || undefined });
    console.log(`✔ ${n}. ${name} (${Date.now() - t} ms)${note ? " — " + note : ""}`);
  } catch (err: any) {
    steps.push({ n, name, ms: Date.now() - t, ok: false, note: err.message.split("\n")[0] });
    console.log(`✘ ${n}. ${name} — ${err.message.split("\n")[0]}`);
    throw err;
  }
}
const nav = (f: FrameLocator, tab: string) => f.getByRole("button", { name: tab, exact: true }).last().click();

test("final two-user E2E (live)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("http://localhost:8090");
  const A = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  const B = page.frameLocator('iframe[title="Pixel 8 (Android)"]');

  await step(1, "Both people signed in (A = Preview Asha, B = Preview Bob)", async () => {
    for (const f of [A, B]) await expect(f.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 90_000 });
  });

  await step(2, "A adds a contact manually", async () => {
    await nav(A, "Add");
    await A.getByPlaceholder("Jane Doe").fill("QA Temp Person");
    await A.getByPlaceholder("CEO, Founder, VP Engineering").fill("Tester");
    await A.getByRole("button", { name: "Save Contact" }).click();
    await expect(A.getByText("Contact saved successfully!").or(A.getByText("QA Temp Person", { exact: true })).first()).toBeVisible({ timeout: 15_000 });
    await A.getByRole("button", { name: "Close" }).first().click().catch(() => {});
  });

  await step(3, "A edits the contact", async () => {
    await nav(A, "Contacts");
    await A.getByText("QA Temp Person", { exact: true }).first().click();
    await A.getByRole("button", { name: "Edit contact", exact: true }).click();
    await A.getByPlaceholder("Jane Doe").fill("QA Temp Person Edited");
    await A.getByRole("button", { name: "Update Contact" }).click();
    await expect(A.getByText("Contact updated!").or(A.getByText("QA Temp Person Edited", { exact: true })).first()).toBeVisible({ timeout: 15_000 });
    await A.getByRole("button", { name: "Close" }).first().click().catch(() => {});
  });

  await step(4, "A deletes the contact (two taps)", async () => {
    await nav(A, "Contacts");
    await A.getByText("QA Temp Person Edited", { exact: true }).first().click();
    await A.getByRole("button", { name: "Delete contact" }).click();
    await A.getByRole("button", { name: "Confirm delete" }).click();
    await expect(A.getByText("QA Temp Person Edited", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });

  await step(5, "B can't see A's contacts (isolation)", async () => {
    await nav(B, "Contacts");
    await expect(B.getByText("QA Temp Person", { exact: false })).toHaveCount(0);
  });

  await step(6, "Both turn on Nearby (Radar, no event)", async () => {
    for (const f of [A, B]) {
      await nav(f, "Radar");
      await f.getByRole("tab", { name: "Nearby" }).click();
      const on = f.getByRole("button", { name: "Turn on Nearby" });
      if (await on.isVisible().catch(() => false)) await on.click();
      await expect(f.getByRole("switch", { name: "Discoverable" })).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
    }
  });

  let t0 = 0;
  await step(7, "A and B discover each other over (simulated) Bluetooth", async () => {
    t0 = Date.now();
    await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 60_000 });
    await expect(B.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Asha")).toBeVisible({ timeout: 60_000 });
    return `${Date.now() - t0} ms after both were on`;
  });

  await step(8, "A sends a connection request", async () => {
    await A.getByRole("list", { name: "Nearby attendees" }).getByRole("button", { name: "Connect" }).click();
    await expect(A.getByRole("list", { name: "Nearby attendees" }).getByRole("button", { name: /Requested/ })).toBeVisible();
    t0 = Date.now();
  });

  await step(9, "B receives it in realtime (request card + bell badge)", async () => {
    await expect(B.getByRole("region", { name: "Connection requests" }).getByText("Preview Asha")).toBeVisible({ timeout: 30_000 });
    const ms = Date.now() - t0;
    await expect(B.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 15_000 });
    return `${ms} ms`;
  });

  await step(10, "B opens the notification centre and sees the request", async () => {
    await B.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
    const centre = B.getByRole("dialog", { name: "Notifications" });
    await expect(centre.getByText("Preview Asha wants to connect")).toBeVisible();
    await centre.getByRole("button", { name: "Close" }).first().click().catch(async () => B.locator("body").press("Escape"));
  });

  await step(11, "B accepts", async () => {
    await nav(B, "Radar");
    await B.getByRole("region", { name: "Connection requests" }).getByRole("button", { name: "Accept" }).click();
    await expect(B.getByText("Preview Asha added to your contacts")).toBeVisible();
    t0 = Date.now();
  });

  await step(12, "A is told in realtime and Bob appears in A's contacts without reload", async () => {
    await expect(A.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 30_000 });
    const ms = Date.now() - t0;
    await nav(A, "Contacts");
    await expect(A.getByText("Preview Bob", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    return `${ms} ms`;
  });

  await step(13, "B has Asha in contacts", async () => {
    await nav(B, "Contacts");
    await expect(B.getByText("Preview Asha", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  await step(14, "A opens AI email for Bob (prospect details prefilled) and closes it", async () => {
    await A.getByText("Preview Bob", { exact: true }).first().click();
    await A.getByRole("button", { name: "Write Email" }).click();
    const dlg = A.getByRole("dialog", { name: "Write email to Preview Bob" });
    await expect(dlg.getByLabel("Email")).toHaveValue("preview.b@networq.co.in");
    await dlg.getByRole("button", { name: "Close" }).click();
  });

  await step(15, "B blocks A from Radar; they disappear for each other", async () => {
    await nav(A, "Radar"); // Radar only broadcasts while its screen is open
    await nav(B, "Radar");
    await expect(B.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Asha")).toBeVisible({ timeout: 60_000 });
    await B.getByRole("list", { name: "Nearby attendees" }).getByRole("button", { name: "View Preview Asha" }).click();
    await B.getByRole("button", { name: "Block Preview Asha" }).click();
    await B.getByRole("button", { name: "Confirm: Block Preview Asha" }).click();
    await expect(B.getByRole("list", { name: "Nearby attendees" })).toHaveCount(0, { timeout: 30_000 });
    await expect(A.getByRole("list", { name: "Nearby attendees" })).toHaveCount(0, { timeout: 60_000 });
  });

  await step(16, "B unblocks A in Settings → Blocked people", async () => {
    await B.getByTitle("Profile & Settings").click();
    const list = B.getByRole("list", { name: "Blocked people" });
    await list.scrollIntoViewIfNeeded();
    await list.getByRole("button", { name: "Unblock Preview Asha" }).click();
    await expect(B.getByText("You haven't blocked anyone.")).toBeVisible();
  });

  await step(17, "After unblocking they find each other again", async () => {
    await nav(B, "Radar");
    await nav(A, "Radar");
    await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 60_000 });
  });

  await step(18, "Events: real events load and filters work", async () => {
    await nav(A, "Events");
    await expect(A.getByRole("list", { name: "Upcoming events" })).toBeVisible({ timeout: 30_000 });
    const all = await A.getByRole("group", { name: "Filter by category" }).getByRole("button").first().innerText();
    await A.getByLabel("City").selectOption("All India");
    await A.getByRole("group", { name: "Filter by date" }).getByRole("button", { name: "This month" }).click();
    const count = await A.getByText(/^\d+ events?$/).innerText();
    await A.getByRole("button", { name: "Clear filters" }).click();
    return `${all.replace(" · ", " ")} upcoming; India this month: ${count}`;
  });

  await step(19, "Digital Pass shows a scannable QR", async () => {
    await nav(A, "Pass");
    await expect(A.getByRole("img", { name: "QR Code" })).toHaveAttribute("src", /^data:image\/png/);
  });

  await step(20, "Scanner has exactly Scan and Upload", async () => {
    await nav(A, "Scan");
    await expect(A.getByRole("button", { name: "Scan with camera" })).toBeVisible();
    await expect(A.getByRole("button", { name: "Upload a photo" })).toBeVisible();
  });

  await step(21, "Settings: notification switch saves", async () => {
    await A.getByTitle("Profile & Settings").click();
    const sw = A.getByRole("switch", { name: "Product updates" });
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await expect(sw).not.toHaveAttribute("aria-checked", before!);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", before!);
  });

  await step(22, "A signs out", async () => {
    await A.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(A.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 20_000 });
  });

  await step(23, "Wrong password is refused", async () => {
    await A.getByPlaceholder("name@company.com").fill("preview.a@networq.co.in");
    await A.locator('input[type="password"]').fill("wrong-password-123");
    await A.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(A.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(A.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible({ timeout: 15_000 });
  });

  await step(24, "A signs back in with the right password", async () => {
    await A.locator('input[type="password"]').fill("Preview#2026");
    await A.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(A.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 30_000 });
  });

  await step(25, "A's data is intact after re-login (Bob still a contact)", async () => {
    await nav(A, "Contacts");
    await expect(A.getByText("Preview Bob", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  await step(26, "No JavaScript errors in either app during the run", async () => {
    expect(consoleErrors).toEqual([]);
  });

  await page.screenshot({ path: "qa-logs/final-e2e.png" });
  require("fs").writeFileSync("qa-logs/final-e2e.json", JSON.stringify(steps, null, 2));
});

test.afterAll(() => {
  require("fs").writeFileSync("qa-logs/final-e2e.json", JSON.stringify(steps, null, 2));
});
