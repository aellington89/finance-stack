"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { type ActionState } from "@/lib/actions/utils";
import { log } from "@/lib/log";
import {
  isLoginRateLimited,
  loginRetryAfterMinutes,
} from "@/lib/security/login-limit";

export async function authenticate(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = formData.get("username");
  const username = typeof raw === "string" ? raw : "";

  // The limit is *enforced* in authorize() (auth.ts), which every credential
  // attempt reaches. This peek exists only so a locked-out user is told so:
  // authorize() can only return null, which renders as "Invalid username or
  // password." — accurate, and useless when the password was right.
  //
  // Peeking rather than decoding Auth.js's CredentialsSignin `code` off the
  // thrown AuthError keeps this off the beta internals of next-auth v5.
  if (isLoginRateLimited(username)) {
    log.warn("Sign-in rejected by rate limit", {
      scope: "login",
      entry_point: "action",
    });

    const minutes = loginRetryAfterMinutes(username);
    return {
      success: false,
      errors: {},
      message: `Too many sign-in attempts. Try again in ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
    };
  }

  try {
    // Reads username, password, and redirectTo from the form. On success
    // signIn redirects (throws NEXT_REDIRECT), so the happy path never
    // reaches the return below — which is also why the failed-attempt budget
    // is cleared inside authorize() rather than here.
    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      // Generic message regardless of unknown-user vs wrong-password.
      return {
        success: false,
        errors: {},
        message: "Invalid username or password.",
      };
    }
    throw error;
  }
  return { success: true, errors: {}, message: "Signed in" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
