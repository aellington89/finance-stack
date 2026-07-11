import { auth } from "@/auth";
import type { ActionState } from "@/lib/actions/utils";

/**
 * Session gate for server actions. Returns an unauthorized ActionState when
 * there is no session, null when the request is authenticated:
 *
 *   const denied = await requireActionUser();
 *   if (denied) return denied;
 *
 * Server actions are directly POST-able regardless of which page renders
 * them, so this per-action check — not the proxy or the layout — is the
 * real boundary for the mutation surface.
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
  return null;
}
