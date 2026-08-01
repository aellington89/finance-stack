import { auth } from "@/auth";
import { reportError } from "@/lib/report";
import type { ActionState } from "@/lib/actions/utils";

/**
 * The failure arm of a server action (Issue #129):
 *
 *   } catch (error) {
 *     return actionFailure("createAccount", error, "Failed to create account. Please try again.");
 *   }
 *
 * Reports the real error with the actor attached and returns the friendly
 * `ActionState` the form renders. Keeping it a per-catch helper rather than a
 * wrapper around the whole action is deliberate — each action keeps its own
 * control flow (the `notFound` flags in transaction.ts, the `redirect()` after
 * deleteAccount, the in-use pre-check reads), and a higher-order wrapper would
 * have to distinguish those from real failures.
 *
 * Note that Next's own error hooks never see these: every action here catches
 * and returns rather than throwing, so `instrumentation.ts#onRequestError`
 * only covers what escapes. The two are complementary, not redundant.
 *
 * Lives here rather than in lib/actions/utils.ts because that file is imported
 * by client components and must stay free of server-only imports — the same
 * reason requireActionUser() lives in lib/auth/guard.ts.
 *
 * `auth()` is called on the error path only; as documented on
 * auditedTransaction(), it decodes the session cookie with no database
 * round-trip. Attribution matters most here: a failed mutation writes no
 * audit row, so this log line is the only record that someone tried.
 */
export async function actionFailure(
  action: string,
  error: unknown,
  message: string
): Promise<ActionState> {
  // Resolving the actor must never replace the failure being reported. A
  // malformed session cookie makes auth() reject, and an unguarded await here
  // would throw out of the catch block that called us — turning a handled
  // "Failed to create account" into an unhandled 500.
  let userId: string | undefined;
  try {
    const session = await auth();
    userId = session?.user?.id;
  } catch {
    userId = undefined;
  }

  reportError(error, { action, user_id: userId });

  return { success: false, errors: {}, message };
}
