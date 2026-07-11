import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/auth/verify-credentials";

declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      id: string;
      role?: string;
    } & DefaultSession["user"];
  }
}

// Credentials provider forces JWT sessions (Auth.js cannot persist DB
// sessions for Credentials), so the only table needed is `users`. Signing
// out clears the cookie; there is no server-side revocation — acceptable
// for the single-user model, documented in docs/auth.md.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Self-hosted behind Docker/reverse proxies with no fixed public URL:
  // trust the Host header from the request instead of requiring AUTH_URL.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username =
          typeof credentials?.username === "string" ? credentials.username : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        const user = await verifyCredentials(username, password);
        if (!user) return null;

        return { id: user.id, name: user.username, role: user.role };
      },
    }),
  ],
  callbacks: {
    // Used by the proxy (app/proxy.ts) to decide whether a matched request
    // may proceed; false triggers a redirect to pages.signIn.
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") session.user.id = token.id;
      if (typeof token.role === "string") session.user.role = token.role;
      return session;
    },
  },
});
