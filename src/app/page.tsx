type Row = {
  ts: string;
  src_ip: string;
  command: string;
  failed: boolean | null;
  session_id: string;
};

export default async function Page() {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/attacks`, {
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `API /api/attacks gagal (${res.status}): ${text}`
    );
  }

  const data = text ? JSON.parse(text) : [];

  return (
    <main style={{ padding: 24 }}>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
