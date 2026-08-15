// First-user CLI (`npm run auth:create-user -- <username>`): there is no
// public registration, so the initial account — and any password reset — is
// created here. Upserts on username, so re-running with an existing username
// resets that user's password.
//
// The password is read from a hidden interactive prompt, or from the
// CREATE_USER_PASSWORD env var for non-interactive use (e.g. inside the
// finance-app container). DATABASE_URL selects the target database; when it
// is unset, .env.local is loaded (which points at Finances_Test for local
// development).

import { config } from "dotenv";
import { resolve } from "node:path";
import { DEFAULT_ROLE, USER_ROLES, isUserRole } from "@/lib/auth/roles";

config({ path: resolve(process.cwd(), ".env.local") });

function askHidden(question: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding("utf8");

    let value = "";
    const onData = (char: string) => {
      if (char === "\r" || char === "\n" || char === "\u0004") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolvePrompt(value);
      } else if (char === "\u0003") {
        // Ctrl-C
        process.stdout.write("\n");
        process.exit(1);
      } else if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

// `--role <admin|user>`, anywhere after the username. Defaults to admin, which
// keeps the first-user flow and every existing script unchanged — a lone
// operator on a single-user install should not have to know roles exist to set
// their own account up (issue #87).
function parseRole(argv: string[]): string {
  const flag = argv.indexOf("--role");
  if (flag === -1) return DEFAULT_ROLE;

  const value = (argv[flag + 1] ?? "").trim();
  if (!isUserRole(value)) {
    console.error(`--role must be one of: ${USER_ROLES.join(", ")}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const username = (args.find((a) => !a.startsWith("--")) ?? "").trim();
  if (!username) {
    console.error("Usage: npm run auth:create-user -- <username> [--role admin|user]");
    console.error(
      "Password is prompted interactively, or read from CREATE_USER_PASSWORD."
    );
    process.exit(1);
  }

  const role = parseRole(args);

  let password = process.env.CREATE_USER_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error(
        "No TTY for the password prompt. Set CREATE_USER_PASSWORD instead."
      );
      process.exit(1);
    }
    password = await askHidden(`Password for "${username}": `);
    const confirm = await askHidden("Confirm password: ");
    if (password !== confirm) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  // Imported dynamically so dotenv has populated DATABASE_URL before the
  // db module reads it at load time.
  const { db } = await import("@/lib/db");
  const { users } = await import("@/drizzle/schema");
  const { hashPassword } = await import("@/lib/auth/password");

  const passwordHash = await hashPassword(password);

  // The role is written on the upsert path too, so re-running this is how you
  // promote or demote an existing account as well as how you reset a password.
  // Omitting --role on a re-run therefore resets the role to admin — stated in
  // the output below rather than left to be discovered.
  const [row] = await db
    .insert(users)
    .values({ username, passwordHash, role })
    .onConflictDoUpdate({
      target: users.username,
      set: { passwordHash, role },
    })
    .returning({ userId: users.userId, createdAt: users.createdAt });

  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  console.log(
    `✓ User "${username}" is ready in ${dbName} (id ${row.userId}, role ${role}).`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("create-user failed:", error);
  process.exit(1);
});
