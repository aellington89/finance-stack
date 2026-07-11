import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { verifyPassword } from "@/lib/auth/password";

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

/**
 * Looks up a user by username and verifies the password against the stored
 * scrypt hash. Returns the user on success, null on unknown user or wrong
 * password (indistinguishable to the caller by design).
 *
 * Kept separate from the NextAuth config so it can be integration-tested
 * against the real database without the NextAuth wrapper.
 */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<AuthUser | null> {
  const trimmed = username.trim();
  if (!trimmed || !password) return null;

  const [row] = await db
    .select({
      userId: users.userId,
      username: users.username,
      passwordHash: users.passwordHash,
      role: users.role,
    })
    .from(users)
    .where(eq(users.username, trimmed))
    .limit(1);

  if (!row) return null;
  if (!(await verifyPassword(password, row.passwordHash))) return null;

  return { id: row.userId, username: row.username, role: row.role };
}
