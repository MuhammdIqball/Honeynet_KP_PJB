import { sql } from "@/lib/neon";

export const dynamic = "force-dynamic";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let lastId = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        if (closed) return;
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
        // LOOP realtime (BUKAN setInterval)
        while (!closed) {
          const rows: any = await sql`
            SELECT
              id,
              src_ip,
              username,
              password,
              success,
              ts
            FROM cowrie_auth_attempts
            WHERE id > ${lastId}
            ORDER BY ts ASC;
          `;

          // send only when there's new data (rows may be an array or object)
          const resultRows = Array.isArray(rows) ? rows : ((rows as any)?.rows ?? []);
          if (resultRows.length > 0) {
            send(resultRows);

            // advance lastId to the highest id we've seen
            const maxId = Math.max(...resultRows.map((r: any) => Number(r.id) || 0));
            if (maxId > lastId) lastId = maxId;
          }

          // delay polling
          await sleep(3000);
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
