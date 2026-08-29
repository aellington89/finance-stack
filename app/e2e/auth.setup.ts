import { test as setup, expect } from "@playwright/test";

import { E2E_PASSWORD, E2E_USERNAME, STORAGE_STATE } from "./fixtures/constants";

/**
 * Signs in once and saves the session cookie for every spec that follows.
 *
 * This is also the only place the login path is exercised, and it is exercised
 * for real — the form in components/auth/login-form.tsx, the `authenticate`
 * action, the Credentials provider and the scrypt verification behind it. A
 * spec that instead injected a forged session cookie would skip all four.
 *
 * One attempt, with correct credentials: the sign-in limiter allows five
 * failures per username (Issue #182), and a retry loop here would spend that
 * budget on the run's own behalf.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Username").fill(E2E_USERNAME);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // signIn() redirects on success, so arriving at /dashboard *is* the
  // assertion that the credentials were accepted.
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("kpi-net-worth")).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
