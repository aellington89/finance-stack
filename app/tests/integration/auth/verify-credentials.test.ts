import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { hashPassword } from "@/lib/auth/password";
import { verifyCredentials } from "@/lib/auth/verify-credentials";

const USERNAME = "vc-test-user";
const PASSWORD = "correct horse battery staple";

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

describe("verifyCredentials", () => {
  it("returns the user for valid credentials", async () => {
    const user = await verifyCredentials(USERNAME, PASSWORD);
    expect(user).not.toBeNull();
    expect(user?.username).toBe(USERNAME);
    expect(user?.role).toBe("admin");
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("trims surrounding whitespace from the username", async () => {
    const user = await verifyCredentials(`  ${USERNAME}  `, PASSWORD);
    expect(user?.username).toBe(USERNAME);
  });

  it("returns null for a wrong password", async () => {
    expect(await verifyCredentials(USERNAME, "wrong-password")).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(await verifyCredentials("no-such-user", PASSWORD)).toBeNull();
  });

  it("returns null for blank username or password", async () => {
    expect(await verifyCredentials("", PASSWORD)).toBeNull();
    expect(await verifyCredentials("   ", PASSWORD)).toBeNull();
    expect(await verifyCredentials(USERNAME, "")).toBeNull();
  });
});
