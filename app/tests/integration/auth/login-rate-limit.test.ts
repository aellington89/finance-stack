import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { hashPassword } from "@/lib/auth/password";
import { authorizeCredentials } from "@/lib/auth/authorize-credentials";
import { __resetAllLimits } from "@/lib/security/rate-limit";

/**
 * The sign-in rate limit (#182) against a real user row, exercising the module
 * that `authorize()` in auth.ts delegates to. auth.ts itself is not importable
 * here — `next-auth` reaches for the `next/server` runtime this project does
 * not provide — which is why the logic lives in lib/auth/authorize-credentials.ts.
 */

const USERNAME = "rate-limit-test-user";
const PASSWORD = "correct horse battery staple";
const WRONG = "not-the-password";

/** RATE_LIMITS.login.max */
const MAX_FAILURES = 5;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await db
    .insert(users)
    .values({ username: USERNAME, passwordHash })
    .onConflictDoUpdate({ target: users.username, set: { passwordHash } });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.username, USERNAME));
});

// vitest-setup.ts already resets between tests; repeated here so this file is
// readable on its own — the counts it builds up are the whole subject.
beforeEach(() => {
  __resetAllLimits();
});

async function failTimes(username: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await authorizeCredentials(username, WRONG);
  }
}

describe("sign-in rate limit", () => {
  it("lets a correct password through under the limit", async () => {
    await failTimes(USERNAME, MAX_FAILURES - 1);

    const user = await authorizeCredentials(USERNAME, PASSWORD);
    expect(user?.username).toBe(USERNAME);
  });

  it("refuses a correct password once the budget is spent", async () => {
    // The assertion that matters: the password is right, the user exists, and
    // the only thing refusing the sign-in is the limiter.
    await failTimes(USERNAME, MAX_FAILURES);

    expect(await authorizeCredentials(USERNAME, PASSWORD)).toBeNull();
  });

  it("blocks before touching the database", async () => {
    await failTimes(USERNAME, MAX_FAILURES);

    // Short-circuiting ahead of the users lookup is what keeps a blocked
    // attempt from paying for a query and, behind it, a scrypt verification —
    // the property that makes this a DoS control and not only a brute-force one.
    const selectSpy = vi.spyOn(db, "select");

    try {
      expect(await authorizeCredentials(USERNAME, PASSWORD)).toBeNull();
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("clears the budget after a successful sign-in", async () => {
    await failTimes(USERNAME, MAX_FAILURES - 1);

    expect(await authorizeCredentials(USERNAME, PASSWORD)).not.toBeNull();

    // Four failures were forgiven, so four more are available rather than one.
    await failTimes(USERNAME, MAX_FAILURES - 1);
    expect(await authorizeCredentials(USERNAME, PASSWORD)).not.toBeNull();
  });

  it("counts failures against an unknown username too", async () => {
    // Otherwise a spray across guessed names would be unthrottled.
    await failTimes("no-such-user", MAX_FAILURES);

    expect(await authorizeCredentials("no-such-user", PASSWORD)).toBeNull();
  });

  it("does not let one username's failures block another", async () => {
    await failTimes("no-such-user", MAX_FAILURES);

    expect(await authorizeCredentials(USERNAME, PASSWORD)).not.toBeNull();
  });

  it("cannot be reset by changing the capitalization", async () => {
    await failTimes(USERNAME.toUpperCase(), MAX_FAILURES);

    expect(await authorizeCredentials(USERNAME, PASSWORD)).toBeNull();
  });

  it("lets the user back in once the window expires", async () => {
    await failTimes(USERNAME, MAX_FAILURES);
    expect(await authorizeCredentials(USERNAME, PASSWORD)).toBeNull();

    // Only Date.now() is moved, not the whole timer set: this path does real
    // database I/O and a scrypt verification, and vi.useFakeTimers() would take
    // setImmediate out from under the pg driver along with the clock.
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 15 * 60_000 + 1);

    try {
      expect(await authorizeCredentials(USERNAME, PASSWORD)).not.toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });
});
