import { NextResponse } from "next/server";
import { getUsers, initDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  await initDb();
  const users = await getUsers();
  return NextResponse.json({ total: users.length, users });
}
