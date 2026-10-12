import type { Browser, Page } from "@playwright/test";
import { test, expect, login, isMobileProject, PASSWORD } from "./fixtures";
import type { MockSupabase } from "./mock-supabase";

// ── Fake Android shell ────────────────────────────────────────────────────────
// Stands in for App.native.tsx + the Kotlin BLE module: answers the web app's
// bridge messages the way radar/shellBridge.ts does, and lets tests inject BLE sightings.
type ShellConfig = { state: "on" | "off" | "unsupported" | "no_advertiser"; permission: "granted" | "denied" | "blocked" };

async function installFakeShell(page: Page, config: ShellConfig = { state: "on", permission: "granted" }, consent: "auto" | "manual" = "auto") {
  // Most tests aren't about consent: agree to the Radar permissions sheet whenever it appears
  if (consent === "auto") await autoAgreeToRadar(page);
  await page.addInitScript((initial) => {
    const w = window as any;
    w.__shell = { ...initial, sent: [] as any[], token: undefined as string | null | undefined };
    const reply = (detail: any) => setTimeout(() => window.dispatchEvent(new CustomEvent("networq-native", { detail })), 10);
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const msg = JSON.parse(raw);
        const shell = w.__shell;
        shell.sent.push(msg);
        if (msg.type === "radar:capabilities") reply({ type: "radar:capabilities", state: shell.state, permission: shell.permission });
        if (msg.type === "radar:start") {
          shell.token = msg.token;
          if (shell.permission !== "granted") reply({ type: "radar:capabilities", state: shell.state, permission: shell.permission });
          else reply({ type: "radar:state", state: shell.state });
        }
        if (msg.type === "radar:token") shell.token = msg.token;
      },
    };
  }, config);
}

async function sendSightings(page: Page, token: string, rssi: number, times = 4) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(
      ([tok, r]) => {
        window.dispatchEvent(new CustomEvent("networq-native", { detail: { type: "radar:sightings", items: [{ token: tok, rssi: r, ts: Date.now() }] } }));
      },
      [token, rssi] as [string, number]
    );
    await page.waitForTimeout(150);
  }
}

async function openRadar(page: Page) {
  if (isMobileProject()) await page.getByRole("button", { name: "Radar", exact: true }).last().click();
  else await page.getByRole("complementary").getByRole("button", { name: /^Proximity Radar/ }).click();
}

// Agrees to the Radar permissions sheet the moment it appears (a real person would tick each box and tap Agree)
async function autoAgreeToRadar(page: Page) {
  await page.addInitScript(() => {
    const tryAgree = () => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Radar permissions"]');
      if (!dlg) return;
      dlg.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((b) => { if (!b.checked) b.click(); });
      const agree = Array.from(dlg.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Agree and turn on");
      if (agree && !agree.disabled) agree.click();
    };
    new MutationObserver(tryAgree).observe(document, { childList: true, subtree: true, attributes: true });
  });
}

async function agreeToRadar(page: Page) {
  const dlg = page.getByRole("dialog", { name: "Radar permissions" });
  for (const box of await dlg.getByRole("checkbox").all()) await box.check();
  await dlg.getByRole("button", { name: "Agree and turn on" }).click();
}

async function newPage(browser: Browser, db: MockSupabase, shell?: ShellConfig | "none", consent: "auto" | "manual" = "auto") {
  const ctx = await browser.newContext(isMobileProject() ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {});
  await db.attach(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (shell !== "none") await installFakeShell(page, shell, consent);
  else if (consent === "auto") await autoAgreeToRadar(page);
  return { page, ctx, errors };
}

function seed(db: MockSupabase) {
  db.addUser("asha@acme.test", PASSWORD, { profile: { name: "Asha Rao", company: "Acme Labs", role: "Founder" } });
  db.addUser("bob@acme.test", PASSWORD, { profile: { name: "Bob Iyer", company: "Seed Fund", role: "Partner" } });
  db.addUser("eve@acme.test", PASSWORD, { profile: { name: "Eve Outsider", company: "Elsewhere", role: "CTO" } });
}

// Radar opens on Nearby; event actions live on the Events tab
async function eventsTab(page: Page) {
  const tab = page.getByRole("tab", { name: "Events" });
  await tab.click(); // waits for Radar to finish loading
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function createEvent(page: Page, name: string) {
  await eventsTab(page);
  await page.getByRole("button", { name: "Create event" }).click();
  await page.getByLabel("Event name").fill(name);
  await page.getByRole("button", { name: "Create & get code" }).click();
  const dialog = page.getByRole("dialog", { name: "Share event" });
  await expect(dialog).toBeVisible();
  const code = (await dialog.getByText(/^NQ-[A-Z0-9]{6}$/).textContent())!.trim();
  await dialog.getByRole("button", { name: "Close" }).click();
  return code;
}

async function joinEvent(page: Page, code: string) {
  await eventsTab(page);
  await page.getByLabel("Event code").fill(code);
  await page.getByRole("button", { name: "Join event" }).click();
}

test.describe("Event Radar", () => {
  // Each test drives two browsers; running them one at a time keeps BLE timing stable on small machines
  test.describe.configure({ mode: "serial" });
  test("two attendees discover each other over BLE and exchange contacts by consent", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db);
    const bob = await newPage(browser, db);

    await login(asha.page, "asha@acme.test");
    await openRadar(asha.page);
    const code = await createEvent(asha.page, "Founders Night");
    expect(code).toMatch(/^NQ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    await expect(asha.page.getByText("Live at")).toBeVisible();

    await login(bob.page, "bob@acme.test");
    await openRadar(bob.page);
    await joinEvent(bob.page, code);
    await expect(bob.page.getByText("You're in: Founders Night")).toBeVisible();

    // Bob's phone advertises a server-issued token; Asha's phone "hears" it at about 5 m
    await expect.poll(() => db.tokenFor("bob@acme.test")).toMatch(/^[0-9a-f]{16}$/);
    const bobToken = db.tokenFor("bob@acme.test")!;
    expect(await bob.page.evaluate(() => (window as any).__shell.token)).toBe(bobToken);
    await sendSightings(asha.page, bobToken, -79, 6);
    // A real phone keeps hearing Bob; without this he'd drop off after 30 s on a slow machine
    const hearing = setInterval(() => sendSightings(asha.page, bobToken, -79, 1).catch(() => {}), 2000);

    const nearby = asha.page.getByRole("list", { name: "Nearby attendees" });
    await expect(nearby.getByText("Bob Iyer")).toBeVisible({ timeout: 15_000 });
    await expect(nearby.getByText("~5 m")).toBeVisible({ timeout: 15_000 });
    expect(await nearby.textContent()).not.toContain("bob@acme.test"); // no contact details before consent

    // Asha requests, Bob accepts → both get a contact
    await nearby.getByRole("button", { name: "Connect" }).click();
    await expect(nearby.getByRole("button", { name: "Requested" })).toBeVisible();
    const requests = bob.page.getByRole("region", { name: "Connection requests" });
    await expect(requests.getByText("Asha Rao")).toBeVisible({ timeout: 15_000 });
    await requests.getByRole("button", { name: "Accept" }).click();
    await expect(bob.page.getByText("Asha Rao added to your contacts")).toBeVisible();

    const contacts = db.table("contacts");
    expect(contacts.find((c) => c.user_id === db.users[0].id)).toMatchObject({ name: "Bob Iyer", email: "bob@acme.test", reference: "NetworQ Radar", event: "Founders Night" });
    expect(contacts.find((c) => c.user_id === db.users[1].id)).toMatchObject({ name: "Asha Rao", email: "asha@acme.test" });

    clearInterval(hearing);
    expect([...asha.errors, ...bob.errors]).toEqual([]);
    await asha.ctx.close();
    await bob.ctx.close();
  });

  test("Nearby (no event): off by default, discoverable people found over BLE, request works, hidden people vanish", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db);
    const bob = await newPage(browser, db);
    for (const [p, email] of [[asha.page, "asha@acme.test"], [bob.page, "bob@acme.test"]] as const) {
      await login(p, email);
      await openRadar(p);
      await p.getByRole("tab", { name: "Nearby" }).click();
      await expect(p.getByRole("button", { name: "Turn on Nearby" })).toBeVisible();
    }
    expect(db.tokenFor("bob@acme.test")).toBeUndefined(); // nothing broadcast before opting in
    for (const p of [asha.page, bob.page]) {
      await p.getByRole("button", { name: "Turn on Nearby" }).click();
      await expect(p.getByRole("switch", { name: "Discoverable" })).toBeVisible(); // permissions agreed, Nearby is on
    }
    await expect(bob.page.getByRole("switch", { name: "Discoverable" })).toHaveAttribute("aria-checked", "true");

    await expect.poll(() => db.tokenFor("bob@acme.test")).toMatch(/^[0-9a-f]{16}$/);
    await sendSightings(asha.page, db.tokenFor("bob@acme.test")!, -79, 6);
    const nearby = asha.page.getByRole("list", { name: "Nearby attendees" });
    await expect(nearby.getByText("Bob Iyer")).toBeVisible();
    await nearby.getByRole("button", { name: "Connect" }).click();
    await expect(bob.page.getByRole("region", { name: "Connection requests" }).getByText("Asha Rao")).toBeVisible({ timeout: 15_000 });

    // Bob hides: his token is revoked and a fresh sighting of it resolves to nobody
    const old = db.tokenFor("bob@acme.test")!;
    await bob.page.getByRole("switch", { name: "Discoverable" }).click();
    await expect.poll(() => db.tokenFor("bob@acme.test")).toBeUndefined();
    // Bob back on: a new token is issued only after the server saved the change
    await bob.page.getByRole("switch", { name: "Discoverable" }).click();
    await expect.poll(() => db.tokenFor("bob@acme.test")).toMatch(/^[0-9a-f]{16}$/);
    expect(db.tokenFor("bob@acme.test")).not.toBe(old);

    // Nearby never appears as an event, and turning it off removes you
    await asha.page.getByRole("tab", { name: "Events" }).click();
    await expect(asha.page.getByRole("button", { name: "Create event" })).toBeVisible();
    await bob.page.getByRole("button", { name: "Turn off Nearby" }).click();
    await bob.page.getByRole("button", { name: "Confirm: Turn off Nearby" }).click();
    await expect(bob.page.getByRole("button", { name: "Turn on Nearby" })).toBeVisible();
    expect(db.tokenFor("bob@acme.test")).toBeUndefined();
    expect([...asha.errors, ...bob.errors]).toEqual([]);
    await asha.ctx.close();
    await bob.ctx.close();
  });

  test("after a block, the blocked person stops seeing the blocker even though the phone still hears them", async ({ browser, db }) => {
    test.setTimeout(120_000);
    seed(db);
    const asha = await newPage(browser, db);
    const bob = await newPage(browser, db);
    for (const [p, email] of [[asha.page, "asha@acme.test"], [bob.page, "bob@acme.test"]] as const) {
      await login(p, email);
      await openRadar(p);
      await p.getByRole("tab", { name: "Nearby" }).click();
      await p.getByRole("button", { name: "Turn on Nearby" }).click();
      await expect(p.getByRole("switch", { name: "Discoverable" })).toBeVisible();
    }
    await expect.poll(() => db.tokenFor("bob@acme.test")).toMatch(/^[0-9a-f]{16}$/);
    await expect.poll(() => db.tokenFor("asha@acme.test")).toMatch(/^[0-9a-f]{16}$/);
    const bobToken = db.tokenFor("bob@acme.test")!;
    const ashaToken = db.tokenFor("asha@acme.test")!;
    await sendSightings(asha.page, bobToken, -70, 4);
    await sendSightings(bob.page, ashaToken, -70, 4);
    await expect(asha.page.getByRole("list", { name: "Nearby attendees" }).getByText("Bob Iyer")).toBeVisible();
    await expect(bob.page.getByRole("list", { name: "Nearby attendees" }).getByText("Asha Rao")).toBeVisible();

    await bob.page.getByRole("button", { name: "View Asha Rao" }).click();
    await bob.page.getByRole("button", { name: "Block Asha Rao" }).click();
    await bob.page.getByRole("button", { name: "Confirm: Block Asha Rao" }).click();
    await expect(bob.page.getByRole("list", { name: "Nearby attendees" })).toHaveCount(0);

    // Asha's phone keeps hearing Bob's (unchanged) token; the periodic re-check removes him anyway
    const keepHearing = setInterval(() => sendSightings(asha.page, bobToken, -70, 1).catch(() => {}), 1000);
    try {
      await expect(asha.page.getByRole("list", { name: "Nearby attendees" })).toHaveCount(0, { timeout: 30_000 });
    } finally {
      clearInterval(keepHearing);
    }
    expect([...asha.errors, ...bob.errors]).toEqual([]);
    await asha.ctx.close();
    await bob.ctx.close();
  });

  test("signals from people at other events are ignored", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db);
    const eve = await newPage(browser, db);
    await login(asha.page, "asha@acme.test");
    await openRadar(asha.page);
    await createEvent(asha.page, "Founders Night");

    await login(eve.page, "eve@acme.test");
    await openRadar(eve.page);
    await createEvent(eve.page, "Different Meetup");
    await expect.poll(() => db.tokenFor("eve@acme.test")).toBeTruthy();

    await sendSightings(asha.page, db.tokenFor("eve@acme.test")!, -60, 6);
    await asha.page.waitForTimeout(2600); // at least one resolve cycle
    await expect(asha.page.getByText("Eve Outsider")).toHaveCount(0);
    await asha.ctx.close();
    await eve.ctx.close();
  });

  test("incognito attendees are hidden and only see a count", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db);
    const bob = await newPage(browser, db);
    await login(asha.page, "asha@acme.test");
    await openRadar(asha.page);
    const code = await createEvent(asha.page, "Founders Night");
    await login(bob.page, "bob@acme.test");
    await openRadar(bob.page);
    await joinEvent(bob.page, code);
    await expect.poll(() => db.tokenFor("bob@acme.test")).toBeTruthy();
    const oldBobToken = db.tokenFor("bob@acme.test")!;

    await bob.page.getByRole("switch", { name: "Visible to nearby attendees" }).click();
    await expect(bob.page.getByRole("switch", { name: "Visible to nearby attendees" })).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => db.tokenFor("bob@acme.test")).toBeUndefined(); // tokens revoked

    await sendSightings(asha.page, oldBobToken, -65, 6);
    await asha.page.waitForTimeout(2600);
    await expect(asha.page.getByText("Bob Iyer")).toHaveCount(0);

    await expect.poll(() => db.tokenFor("asha@acme.test")).toBeTruthy();
    await sendSightings(bob.page, db.tokenFor("asha@acme.test")!, -65, 6);
    await expect(bob.page.getByText("1 person is nearby. Turn on visibility to see who.")).toBeVisible();
    await expect(bob.page.getByText("Asha Rao")).toHaveCount(0);
    await asha.ctx.close();
    await bob.ctx.close();
  });

  test("browser fallback lists attendees without distance", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db, "none");
    const bob = await newPage(browser, db, "none");
    await login(asha.page, "asha@acme.test");
    await openRadar(asha.page);
    const code = await createEvent(asha.page, "Founders Night");
    await login(bob.page, "bob@acme.test");
    await openRadar(bob.page);
    await joinEvent(bob.page, code);

    await expect(bob.page.getByText("Live distance works in the NetworQ Android app.")).toBeVisible();
    const list = bob.page.getByRole("list", { name: "Nearby attendees" });
    await expect(list.getByText("Asha Rao")).toBeVisible();
    await expect(list.getByText(/~\d+ m|Very close/)).toHaveCount(0);
    await expect(bob.page.getByRole("img", { name: /Radar showing/ })).toHaveCount(0);
    await asha.ctx.close();
    await bob.ctx.close();
  });

  test("Bluetooth off shows a fix-it action that opens settings", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page, { state: "off", permission: "granted" });
    await login(page, "asha@acme.test");
    await openRadar(page);
    await createEvent(page, "Founders Night");
    await expect(page.getByText("Bluetooth is off")).toBeVisible();
    await page.getByRole("button", { name: "Turn on Bluetooth" }).click();
    expect(await page.evaluate(() => (window as any).__shell.sent.map((m: any) => m.type))).toContain("radar:openSettings");
  });

  test("denied permission explains itself and recovers after allowing", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page, { state: "on", permission: "denied" });
    await login(page, "asha@acme.test");
    await openRadar(page);
    await createEvent(page, "Founders Night");
    await expect(page.getByText("Nearby devices permission needed")).toBeVisible();
    await page.evaluate(() => ((window as any).__shell.permission = "granted"));
    await page.getByRole("button", { name: "Allow access" }).click();
    await expect(page.getByText("Nearby devices permission needed")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Radar showing 0 nearby attendees/ })).toBeVisible();
  });

  test("consent is mandatory: Radar stays off (no Bluetooth, no token) until every box is ticked", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page, { state: "on", permission: "granted" }, "manual");
    await login(page, "asha@acme.test");
    await openRadar(page);
    await page.getByRole("tab", { name: "Nearby" }).click();
    await page.getByRole("button", { name: "Turn on Nearby" }).click();

    const dlg = page.getByRole("dialog", { name: "Radar permissions" });
    await expect(dlg.getByRole("heading", { name: "Before Radar turns on" })).toBeVisible();
    await expect(dlg.getByText(/does not use your camera, microphone, contacts or GPS location/)).toBeVisible();
    const agree = dlg.getByRole("button", { name: "Agree and turn on" });
    await expect(agree).toBeDisabled();
    const boxes = await dlg.getByRole("checkbox").all();
    expect(boxes.length).toBe(3); // Bluetooth, show my profile, receive requests
    await boxes[0].check();
    await boxes[1].check();
    await expect(agree).toBeDisabled(); // every box, not most
    const sent = () => page.evaluate(() => (window as any).__shell.sent.map((m: any) => m.type));
    expect(await sent()).not.toContain("radar:start");
    expect(db.tokenFor("asha@acme.test")).toBeUndefined();

    // "Not now" leaves Radar off
    await dlg.getByRole("button", { name: "Not now" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Turn on Nearby" })).toBeVisible();
    expect(await sent()).not.toContain("radar:start");

    // Agreeing to everything turns it on and asks the phone for Bluetooth
    await page.getByRole("button", { name: "Turn on Nearby" }).click();
    await agreeToRadar(page);
    await expect(page.getByRole("switch", { name: "Discoverable" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(sent).toContain("radar:start");
    await expect(page.getByRole("status", { name: "Bluetooth status" })).toContainText("No other NetworQ phone in range yet");

    // Asked once per person on this phone: off and on again doesn't ask twice
    await page.reload();
    await openRadar(page);
    await expect(page.getByRole("switch", { name: "Discoverable" })).toBeVisible();
    await expect(dlg).toHaveCount(0);
  });

  test("joining an event doesn't start Radar until you agree; declining turns it off", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page, { state: "on", permission: "granted" }, "manual");
    await login(page, "asha@acme.test");
    await openRadar(page);
    await createEvent(page, "Founders Night");
    const dlg = page.getByRole("dialog", { name: "Radar permissions" });
    await expect(dlg).toBeVisible();
    expect(await page.evaluate(() => (window as any).__shell.sent.map((m: any) => m.type))).not.toContain("radar:start");
    await dlg.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByText("Radar is off", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__shell.sent.map((m: any) => m.type))).not.toContain("radar:start");
  });

  test("Radar check says what works and what doesn't: Bluetooth off → one tap to fix; then on", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page, { state: "off", permission: "granted" });
    await login(page, "asha@acme.test");
    await openRadar(page);
    await page.getByRole("tab", { name: "Nearby" }).click();
    const check = page.getByRole("region", { name: "Radar check" });
    const row = (label: string) => check.getByRole("listitem").filter({ hasText: label });
    await expect(row("NetworQ app")).toContainText("You're in the Android app.");
    await expect(row("Radar in this app")).toContainText("Ready.");
    await expect(row("Bluetooth")).toContainText("Bluetooth is off"); // known before Radar is even turned on
    await expect(row("Bluetooth")).toHaveAttribute("data-state", "bad");
    await expect(row("Internet")).toContainText("Connected");
    await expect(check.getByText("1 thing to fix")).toBeVisible();
    await row("Bluetooth").getByRole("button", { name: "Turn on" }).click();
    expect(await page.evaluate(() => (window as any).__shell.sent.map((m: any) => m.type))).toContain("radar:openSettings");

    // the person switches Bluetooth on outside the app → the check notices by itself
    await page.evaluate(() => ((window as any).__shell.state = "on"));
    await expect(row("Bluetooth")).toContainText("On.", { timeout: 8000 });
    await expect(check.getByText("Nothing to fix")).toBeVisible();

    await page.getByRole("button", { name: "Turn on Nearby" }).click();
    await expect(row("Nearby devices permission")).toContainText("Allowed.");
    await expect(row("Others can find you")).toContainText("Yes, while the app is open.");
    await expect(row("NetworQ phones in range")).toContainText("None yet.");
  });

  test("Radar check: in a browser, or in an app without Radar, it says so instead of showing an empty list", async ({ browser, db }) => {
    seed(db);
    const web = await newPage(browser, db, "none");
    await login(web.page, "asha@acme.test");
    await openRadar(web.page);
    await expect(web.page.getByRole("region", { name: "Radar check" }).getByText(/You're in a browser/)).toBeVisible();

    const old = await newPage(browser, db, { state: "unsupported", permission: "denied" });
    await login(old.page, "bob@acme.test");
    await openRadar(old.page);
    const check = old.page.getByRole("region", { name: "Radar check" });
    await expect(check.getByText("You're in the Android app.")).toBeVisible();
    await expect(check.getByText(/can't use Bluetooth Radar. Install the latest NetworQ app/)).toBeVisible();
    await web.ctx.close();
    await old.ctx.close();
  });

  test("wrong event code gives a clear error", async ({ page, db }) => {
    seed(db);
    await installFakeShell(page);
    await login(page, "asha@acme.test");
    await openRadar(page);
    await joinEvent(page, "NQ-ZZZZZZ");
    await expect(page.getByText("That event code doesn't exist. Check it and try again.")).toBeVisible();
  });

  test("'I'm attending' on an Events Hub event opens its Radar", async ({ page, db }) => {
    seed(db);
    db.addPublicEvent({ title: "Bengaluru Product Circle", starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), url: "https://lu.ma/product-circle-blr", city: "Bengaluru" });
    await installFakeShell(page);
    await login(page, "asha@acme.test");
    if (isMobileProject()) await page.getByRole("button", { name: "Events", exact: true }).last().click();
    else await page.getByRole("complementary").getByRole("button", { name: /^Events Hub/ }).click();
    await page.getByRole("button", { name: /^Going to / }).first().click();
    await expect(page.getByText("You're attending Bengaluru Product Circle")).toBeVisible();
    await expect(page.getByText("Live at")).toBeVisible();
    expect(db.events[0]).toMatchObject({ source: "listed", external_id: db.table("public_events")[0].id });
  });

  test("invite link ?join=CODE joins the event after sign-in", async ({ browser, db }) => {
    seed(db);
    const asha = await newPage(browser, db);
    await login(asha.page, "asha@acme.test");
    await openRadar(asha.page);
    const code = await createEvent(asha.page, "Founders Night");

    const bob = await newPage(browser, db);
    await bob.page.goto(`/?join=${code}`);
    await bob.page.getByPlaceholder("name@company.com").fill("bob@acme.test");
    await bob.page.locator('input[type="password"]').fill(PASSWORD);
    await bob.page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(bob.page.getByText("You're in: Founders Night")).toBeVisible();
    expect(new URL(bob.page.url()).search).toBe("");
    await asha.ctx.close();
    await bob.ctx.close();
  });
});
