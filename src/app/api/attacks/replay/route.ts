import { sql } from "@/lib/neon";

export const dynamic = "force-dynamic";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;

  // 🔹 replay start time (default: earliest data)
  let cursorTs: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        if (closed || data.length === 0) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", cleanup);

      try {
        // 1️⃣ ambil timestamp paling awal
        const start = await sql`
          SELECT MIN(ts) AS ts
          FROM cowrie_commands
        `;

        cursorTs = start[0]?.ts ?? null;

        if (!cursorTs) {
          cleanup();
          return;
        }

        // 2️⃣ replay loop (1 menit database → 1 menit sekarang)
        while (!closed) {
          const nextTs: Date = new Date(cursorTs!.getTime() + 60_000);
          const rows = await sql`
            SELECT ts, src_ip, command
            FROM cowrie_commands
            WHERE ts >= ${cursorTs}
              AND ts < ${nextTs}
            ORDER BY ts ASC
          `;

          send(rows);

          cursorTs = nextTs;

          // ⏱️ tunggu 1 menit realtime
          await sleep(10000);
        }
      } catch (err) {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
