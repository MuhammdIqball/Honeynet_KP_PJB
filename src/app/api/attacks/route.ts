import { NextResponse } from "next/server";
import { sql } from "@/lib/neon";

export async function GET() {
  try {
    const rows = await sql`
      SELECT *
      FROM cowrie_commands
      ORDER BY ts DESC
    `;

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("=== DB ERROR /api/attacks ===");
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to fetch attacks",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
