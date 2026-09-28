import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { initDb, upsertUser } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      try {
        await initDb();
        await upsertUser(user.email!, user.name, user.image);
      } catch (e) {
        console.error("[auth] db error", e);
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
});
