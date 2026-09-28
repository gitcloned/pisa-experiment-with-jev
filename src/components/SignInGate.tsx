"use client";

import { signIn, signOut } from "next-auth/react";
import Image from "next/image";

interface Props {
  session: { user?: { name?: string | null; email?: string | null; image?: string | null } } | null;
}

export function SignInBanner({ session }: Props) {
  if (!session?.user) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-100">
      {session.user.image && (
        <Image src={session.user.image} alt="" width={24} height={24} className="rounded-full" />
      )}
      <span className="text-xs text-gray-500 flex-1 truncate">{session.user.email}</span>
      <button onClick={() => signOut()} className="text-xs text-gray-400 hover:text-gray-600">Sign out</button>
    </div>
  );
}

export function SignInModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-xs text-center">
        <p className="text-2xl mb-1">📐</p>
        <h2 className="text-lg font-bold text-gray-900 mb-1">PISA Assessment</h2>
        <p className="text-xs text-gray-400 mb-6">Sign in to start — takes one click</p>
        <button
          onClick={() => signIn("google")}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-xl py-3 transition-colors shadow-sm"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8.9 20-20 0-1.3-.1-2.7-.4-4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.5 35.5 26.9 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.6 4.8C9.7 39.7 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l6.2 5.2C40.5 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          Continue with Google
        </button>
        <p className="text-xs text-gray-300 mt-4">Your email is recorded for access tracking</p>
      </div>
    </div>
  );
}
