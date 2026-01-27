import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cowrieCommands } from "@/lib/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(cowrieCommands).orderBy(desc(cowrieCommands.ts)).limit(50);
  return NextResponse.json(rows);
}
