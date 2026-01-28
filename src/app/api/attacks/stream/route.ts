import { sql } from "@/lib/neon";
import { geoLookup } from "@/lib/geoip";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;

  // cursor: timestamp terakhir yang sudah dikirim
  let lastTs: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      req.signal.addEventListener("abort", () => {
        closed = true;
        try { controller.close(); } catch {}
      });

      // 1) kirim batch awal (biar UI langsung terisi)
      const initial = await sql`
        SELECT
          ctid::text AS id,
          ts, src_ip, command, failed, session_id
        FROM public.cowrie_commands
        ORDER BY ts DESC
        LIMIT 20
      `;


      if (initial.length > 0) {
        lastTs = initial[0].ts; // karena DESC, index 0 = terbaru
      }

      const initialEnriched = await Promise.all(
        initial.reverse().map(async (r: any) => ({
          ...r,
          geo: await geoLookup(r.src_ip),
        }))
      );

      send(initialEnriched);

      // 2) loop realtime: hanya kirim data baru
      while (!closed) {
        const rows = lastTs
          ? await sql`
              SELECT
                ctid::text AS id,
                ts, src_ip, command, failed, session_id
              FROM public.cowrie_commands
              WHERE ts > ${lastTs}
              ORDER BY ts ASC
            `
          : await sql`
              SELECT
                ctid::text AS id,
                ts, src_ip, command, failed, session_id
              FROM public.cowrie_commands
              ORDER BY ts ASC
              LIMIT 20
            `;

        if (rows.length > 0) {
          lastTs = rows[rows.length - 1].ts;

          const enriched = await Promise.all(
            rows.map(async (r: any) => ({
              ...r,
              geo: await geoLookup(r.src_ip),
            }))
          );

          send(enriched);
        }

        await sleep(3000);
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
