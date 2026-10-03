import { test, expect } from "@playwright/test";

// Live walk-through of AI research → 3 drafts → review → send, as preview Person A at phone size.
test.use({ viewport: { width: 393, height: 852 } });
test.setTimeout(240_000);

test("prospect research + drafting flow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8081/?devLogin=a");
  await page.getByText("Meera Krishnan", { exact: true }).first().click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Write Email" }).click();
  const dlg = page.getByRole("dialog", { name: "Write email to Meera Krishnan" });
  await expect(dlg.getByLabel("Website")).toHaveValue("kissflow.com");
  await page.screenshot({ path: "qa-logs/prospect-1-details.png" });

  await dlg.getByRole("button", { name: /^Research/ }).click();
  await expect(dlg.getByLabel("Research results")).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-logs/prospect-2-research.png" });
  await dlg.getByLabel("Research results").screenshot({ path: "qa-logs/prospect-2b-research-full.png" });

  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: "Lead generation" }).click();
  await dlg.getByRole("button", { name: "Performance marketing" }).click();
  await dlg.getByRole("radio", { name: "Friendly" }).click();
  await page.screenshot({ path: "qa-logs/prospect-3-context.png" });

  await dlg.getByRole("button", { name: "Generate 3 drafts" }).click();
  await expect(dlg.getByRole("region", { name: "Option C" })).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: "qa-logs/prospect-4-drafts.png" });
  for (const o of ["A", "B", "C"]) await dlg.getByRole("region", { name: `Option ${o}` }).screenshot({ path: `qa-logs/prospect-4-${o}.png` });

  await dlg.getByRole("button", { name: "Use option B" }).click();
  await expect(dlg.getByLabel("Subject")).not.toHaveValue("");
  await page.screenshot({ path: "qa-logs/prospect-5-review.png" });
  await dlg.getByRole("button", { name: "Send email" }).click();
  await dlg.getByRole("button", { name: /Tap again to send/ }).click();
  await expect(dlg.getByText("Email sent")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "qa-logs/prospect-6-sent.png" });
  await dlg.getByRole("button", { name: "Done" }).click();

  await page.getByText("Meera Krishnan", { exact: true }).first().click();
  await expect(page.getByLabel("Email timeline")).toBeVisible();
  await page.getByLabel("Email timeline").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-logs/prospect-7-timeline.png" });
  expect(errors).toEqual([]);
});
