import { auth } from "@/auth";
import type { ActionState } from "@/lib/actions/utils";
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
