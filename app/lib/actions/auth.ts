"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { type ActionState } from "@/lib/actions/utils";

export async function authenticate(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    // Reads username, password, and redirectTo from the form. On success
    // signIn redirects (throws NEXT_REDIRECT), so the happy path never
    // reaches the return below.
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
