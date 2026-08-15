import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import type { ActionState } from "@/lib/actions/utils";
import { isAdminRole } from "@/lib/auth/roles";
import { log } from "@/lib/log";
import { RATE_LIMITS, isRateLimited, recordEvent } from "@/lib/security/rate-limit";

/**
 * Entry gate for server actions. Returns an ActionState to hand straight back
 * when the call should not proceed, null when it may:
 *
 *   const denied = await requireActionUser();
 *   if (denied) return denied;
 *
 * It checks **two** things, and the name only says the first. The session
 * check (Issue #120) is the boundary: server actions are directly POST-able
 * regardless of which page renders them, so this per-action check — not the
 * proxy or the layout — is what actually protects the mutation surface.
 *
 * The rate check (Issue #182) rides along here rather than being a second line
 * at 18 call sites, and that is a deliberate trade. `lib/actions/failure.ts`
 * argues against wrapping actions, because each one owns its control flow —
 * but this is a pre-check that already exists and already returns a denial in
 * the same shape, so folding a second pre-condition into it costs nothing and
 * removes the one failure mode a per-action line would have: a new action
 * forgetting it. Anything guarded is limited, by construction.
 *
 * Lives in lib/auth/ (not lib/actions/utils.ts) because utils.ts is
 * imported by client components and must stay free of server-only imports.
 */
export async function requireActionUser(): Promise<ActionState | null> {
  const session = await auth();
  if (!session?.user) {
    return {
      success: false,
      errors: {},
      message: "You must be signed in to perform this action.",
    };
  }

  // Keyed on the actor, not the action: the point is to bound one session's
  // total mutation rate, and 120/minute leaves normal use — which peaks in the
  // low single digits — two orders of magnitude of headroom. This is an abuse
  // blunt for a runaway client or a stolen session, not a UX gate.
  const key = `action:${session.user.id}`;

  if (isRateLimited(key, RATE_LIMITS.action)) {
    log.warn("Server action rejected by rate limit", {
      scope: "action",
      user_id: session.user.id,
    });

    return {
      success: false,
      errors: {},
      message: "Too many requests. Please wait a moment and try again.",
    };
  }

  recordEvent(key, RATE_LIMITS.action);

  return null;
}

/**
 * The signed-in user's role, read from the database.
 *
 * **Not from the session token, and that is the point.** Sessions here are
 * 30-day JWTs with no server-side revocation (docs/auth.md) — the cookie is
 * only re-issued when Auth.js refreshes it. So a user demoted from `admin` to
 * `user` would keep a cookie asserting `admin` for up to a month, which would
 * make the gate below a suggestion rather than a control. One indexed lookup on
 * a path taken only by lookup-table mutations is the right price for the answer
 * being current.
 *
 * The token's `role` claim is still populated and is still fine for rendering
 * the nav, where being a frame stale costs nothing.
 *
 * Returns null when there is no session, or when the row has been deleted out
 * from under a live cookie.
 */
export async function roleForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);

  return row?.role ?? null;
}

export async function currentUserRole(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return roleForUser(session.user.id);
}

/**
 * Entry gate for server actions that administer the lookup tables (Issue #87).
 *
 *   const denied = await requireAdminUser();
 *   if (denied) return denied;
 *
 * Composes requireActionUser() rather than repeating it, so the session check
 * and the mutation rate limit both still apply — and apply *first*, which is
 * deliberate: a signed-out caller gets "you must be signed in" rather than a
 * permission message that would confirm the endpoint exists, and a runaway
 * client is still bounded whether or not it is an admin.
 *
 * `account_type_categories` and `transaction_types` are the tables behind this
 * gate. They are the basis of the balance-sheet groupings and the transaction
 * classification every KPI reads, so a wrong edit there is not one bad row —
 * it is every dashboard at once.
 */
export async function requireAdminUser(): Promise<ActionState | null> {
  const denied = await requireActionUser();
  if (denied) return denied;

  // requireActionUser() has already established there is a session; this reads
  // it again rather than threading it through, which costs one JWT decode and
  // keeps that function's signature — and its "anything guarded is limited"
  // property — untouched.
  const session = await auth();
  const userId = session?.user?.id;
  const role = userId ? await roleForUser(userId) : null;

  if (!isAdminRole(role)) {
    log.warn("Server action rejected by role gate", {
      scope: "action",
      user_id: userId,
    });

    return {
      success: false,
      errors: {},
      message: "You do not have permission to perform this action.",
    };
  }

  return null;
}
