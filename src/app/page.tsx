'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Geo = {
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  city?: string;
} | null;

type AttackRow = {
  id: string; // harus unik (mis: ctid::text AS id)
  ts: string;
  src_ip: string;
  command: string;
  failed?: boolean;
  session_id?: string | null;
  geo?: Geo;
};

type Stats = {
  totalEventsSeen: number;
  uniqueIPs: number;
  failureRate: number; // %
  eventsPerMinute: number;
  lastSeen: string | null;
  recent: AttackRow[];
};

type MapPoint = {
  key: string;
  x: number;
  y: number;
  type: 'attacker' | 'victim';
  ip: string;
  label: string;
  ts?: string;
};

const DEV_FAKE_ATTACKERS = true; // 🔥 set false kalau sudah ada geo real

const MAP_W = 900;
const MAP_H = 480;

// bounding box kasar Indonesia untuk proyeksi sederhana
const ID_BOUNDS = {
  minLon: 95,
  maxLon: 141,
  minLat: -11,
  maxLat: 6,
};

function projectToMap(lat: number, lon: number, width: number, height: number) {
  const { minLon, maxLon, minLat, maxLat } = ID_BOUNDS;
  const x = ((lon - minLon) / (maxLon - minLon)) * width;
  const y = ((maxLat - lat) / (maxLat - minLat)) * height; // lat: utara lebih atas
  return { x, y };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const VICTIM_IP = '192.168.137.130';
// victim private IP -> lokasi harus statis (contoh Jakarta)
const VICTIM_LAT = -6.2;
const VICTIM_LON = 106.8;

export default function Page() {
  const [stats, setStats] = useState<Stats>({
    totalEventsSeen: 0,
    uniqueIPs: 0,
    failureRate: 0,
    eventsPerMinute: 0,
    lastSeen: null,
    recent: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  // cache attacker point per IP supaya tidak spam titik
  const attackerByIpRef = useRef<Map<string, MapPoint>>(new Map());

  // hitung events/min (window 60s) berdasarkan event yang masuk
  const lastMinuteTimesRef = useRef<number[]>([]);

  const victimPoint = useMemo<MapPoint>(() => {
    const p = projectToMap(VICTIM_LAT, VICTIM_LON, MAP_W, MAP_H);
    return {
      key: `victim:${VICTIM_IP}`,
      x: clamp(p.x, 0, MAP_W),
      y: clamp(p.y, 0, MAP_H),
      type: 'victim',
      ip: VICTIM_IP,
      label: `Victim (${VICTIM_IP}) • Jakarta (static)`,
    };
  }, []);

  const [mapPoints, setMapPoints] = useState<MapPoint[]>([victimPoint]);

  const rebuildMapPoints = () => {
    const attackers = Array.from(attackerByIpRef.current.values())
      .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
      .slice(0, 250);

    setMapPoints([victimPoint, ...attackers]);
  };

  const connectToLiveStream = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const es = new EventSource('/api/attacks/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const rows: AttackRow[] = JSON.parse(event.data);
        if (!Array.isArray(rows) || rows.length === 0) return;

        // ==== STATS + RECENT LOGS ====
        setStats((prev) => {
          const merged = [...prev.recent, ...rows];

          // dedup berdasarkan id (hindari double saat reconnect)
          const byId = new Map<string, AttackRow>();
          for (const r of merged) byId.set(r.id, r);
          const uniqueList = Array.from(byId.values()).sort((a, b) => a.ts.localeCompare(b.ts));

          const recent = uniqueList.slice(-30);

          const totalEventsSeen = uniqueList.length;
          const uniqueIPs = new Set(uniqueList.map((r) => r.src_ip)).size;

          const totalFail = uniqueList.reduce((acc, r) => acc + (r.failed ? 1 : 0), 0);
          const failureRate = totalEventsSeen > 0 ? (totalFail / totalEventsSeen) * 100 : 0;

          const lastSeen = rows[rows.length - 1]?.ts ?? prev.lastSeen;

          return {
            ...prev,
            totalEventsSeen,
            uniqueIPs,
            failureRate: Math.round(failureRate * 100) / 100,
            lastSeen,
            recent,
          };
        });

        // ==== EVENTS / MIN ====
        const now = Date.now();
        const times = lastMinuteTimesRef.current;
        for (let i = 0; i < rows.length; i++) times.push(now);
        const cutoff = now - 60_000;
        while (times.length && times[0] < cutoff) times.shift();
        setStats((prev) => ({ ...prev, eventsPerMinute: times.length }));

        // ==== MAP POINTS (attacker GeoIP real) ====
        let changed = false;

        for (const r of rows) {
          if (!r.geo || r.geo.lat == null || r.geo.lon == null) continue;

          const proj = projectToMap(r.geo.lat, r.geo.lon, MAP_W, MAP_H);
          const x = clamp(proj.x, 0, MAP_W);
          const y = clamp(proj.y, 0, MAP_H);

          const city = [r.geo.city, r.geo.region, r.geo.country].filter(Boolean).join(', ');
          const label = city ? `Attacker (${r.src_ip}) • ${city}` : `Attacker (${r.src_ip})`;

          const existing = attackerByIpRef.current.get(r.src_ip);
          if (!existing || (existing.ts ?? '') < r.ts) {
            attackerByIpRef.current.set(r.src_ip, {
              key: `attacker:${r.src_ip}`,
              x,
              y,
              type: 'attacker',
              ip: r.src_ip,
              label,
              ts: r.ts,
            });
            changed = true;
          }
        }

        if (changed) rebuildMapPoints();
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    es.onerror = (err) => {
      console.error('SSE error:', err);
      es.close();
    };
  };

  useEffect(() => {
    // init map with victim marker
    setMapPoints([victimPoint]);

    // inject FAKE attackers for UI testing (no VPN needed)
    if (DEV_FAKE_ATTACKERS) {
      const fake = [
        { ip: '8.8.8.8', city: 'Jakarta', lat: -6.2, lon: 106.8 },
        { ip: '1.1.1.1', city: 'Surabaya', lat: -7.2575, lon: 112.7521 },
        { ip: '9.9.9.9', city: 'Medan', lat: 3.5952, lon: 98.6722 },
        { ip: '4.2.2.2', city: 'Makassar', lat: -5.1477, lon: 119.4327 },
        { ip: '208.67.222.222', city: 'Jayapura', lat: -2.5337, lon: 140.7181 },
      ];

      const nowIso = new Date().toISOString();

      for (const a of fake) {
        const p = projectToMap(a.lat, a.lon, MAP_W, MAP_H);

        attackerByIpRef.current.set(a.ip, {
          key: `attacker:${a.ip}`,
          x: clamp(p.x, 0, MAP_W),
          y: clamp(p.y, 0, MAP_H),
          type: 'attacker',
          ip: a.ip,
          label: `Attacker (${a.ip}) • ${a.city} (FAKE)`,
          ts: nowIso,
        });
      }

      rebuildMapPoints();
    }

    // connect SSE live
    connectToLiveStream();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [victimPoint]);

  return (
    <main style={styles.root}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Honeynet Dashboard</h1>
          <p style={styles.subtitle}>
            Live stream • Victim fixed at <strong>{VICTIM_IP}</strong>
            {DEV_FAKE_ATTACKERS ? (
              <span style={{ marginLeft: 10, color: '#fbbf24', fontWeight: 800 }}>
                (FAKE attackers enabled)
              </span>
            ) : null}
          </p>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.headerRightLabel}>Last seen</div>
          <div style={styles.headerRightValue}>
            {stats.lastSeen ? new Date(stats.lastSeen).toLocaleString() : '-'}
          </div>
        </div>
      </header>

      {/* KPIs */}
      <section style={styles.kpiGrid}>
        <Kpi title="Total Events" value={stats.totalEventsSeen} />
        <Kpi title="Unique Attackers" value={stats.uniqueIPs} />
        <Kpi title="Failure Rate" value={`${stats.failureRate}%`} />
        <Kpi title="Events / min" value={stats.eventsPerMinute} />
        <Kpi title="Mode" value="LIVE" accent />
      </section>

      <section style={styles.mainGrid}>
        {/* MAP */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>Indonesia Attack Map</h2>
            <Legend />
          </div>

          <div style={styles.mapWrap}>
            <IndonesiaSilhouette width={MAP_W} height={MAP_H} />

            {mapPoints.map((p) => (
              <div
                key={p.key}
                title={p.label}
                style={{
                  position: 'absolute',
                  left: p.x,
                  top: p.y,
                  transform: 'translate(-50%, -50%)',
                  width: p.type === 'victim' ? 14 : 10,
                  height: p.type === 'victim' ? 14 : 10,
                  borderRadius: '50%',
                  background: p.type === 'victim' ? '#00ff88' : '#ff4444',
                  boxShadow:
                    p.type === 'victim'
                      ? '0 0 12px rgba(0,255,136,0.6)'
                      : '0 0 12px rgba(255,68,68,0.55)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              />
            ))}
          </div>

          <p style={styles.footnote}>
            Attacker markers use GeoIP (MaxMind) when available. Victim marker is static for private IP {VICTIM_IP}.
          </p>
        </div>

        {/* RECENT */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>Recent Commands</h2>
            <div style={styles.badge}>{stats.recent.length} shown</div>
          </div>

          <div style={styles.listWrap}>
            {stats.recent.length === 0 ? (
              <div style={styles.empty}>No events yet…</div>
            ) : (
              <ul style={styles.list}>
                {stats.recent
                  .slice()
                  .reverse()
                  .map((a) => (
                    <li key={a.id} style={styles.item}>
                      <div style={styles.itemTop}>
                        <div style={styles.itemIp}>
                          {a.src_ip}
                          {a.geo?.city ? <span style={styles.itemMeta}> • {a.geo.city}</span> : null}
                        </div>

                        <div style={{ ...styles.status, color: a.failed ? '#ff4444' : '#00ff88' }}>
                          {a.failed ? 'FAIL' : 'OK'}
                        </div>
                      </div>

                      <div style={styles.cmd}>
                        <span style={styles.cmdLabel}>cmd:</span>{' '}
                        <span style={styles.cmdMono}>{a.command}</span>
                      </div>

                      <div style={styles.itemBottom}>
                        <span>{new Date(a.ts).toLocaleString()}</span>
                        {a.session_id ? <span>• session: {a.session_id}</span> : null}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Kpi({ title, value, accent }: { title: string; value: any; accent?: boolean }) {
  return (
    <div
      style={{
        ...styles.kpi,
        background: accent ? '#0d1b2a' : '#0a1020',
      }}
    >
      <div style={styles.kpiTitle}>{title}</div>
      <div style={styles.kpiValue}>{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div style={styles.legend}>
      <span style={styles.legendItem}>
        <span style={{ ...styles.dot, background: '#ff4444', boxShadow: '0 0 10px rgba(255,68,68,0.5)' }} />
        Attacker
      </span>
      <span style={styles.legendItem}>
        <span style={{ ...styles.dot, background: '#00ff88', boxShadow: '0 0 10px rgba(0,255,136,0.5)' }} />
        Victim
      </span>
    </div>
  );
}

function IndonesiaSilhouette({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#070c16" />
          <stop offset="100%" stopColor="#0b1220" />
        </linearGradient>
        <linearGradient id="land" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#12314a" />
          <stop offset="100%" stopColor="#0b2539" />
        </linearGradient>
      </defs>

      <rect width={width} height={height} fill="url(#sea)" />

      {/* Landmasses stylized (filled so it’s visible) */}
      {/* Sumatra */}
      <path
        d="M150 250 C120 230, 110 210, 130 190 C150 170, 190 175, 210 200 C230 225, 210 260, 180 270 C165 275, 155 268, 150 250 Z"
        fill="url(#land)"
        opacity="0.95"
      />
      {/* Java */}
      <path
        d="M260 290 C290 275, 350 275, 390 285 C410 290, 410 305, 390 310 C350 320, 290 320, 260 305 C245 298, 245 295, 260 290 Z"
        fill="url(#land)"
        opacity="0.95"
      />
      {/* Borneo */}
      <path
        d="M420 230 C400 205, 410 175, 445 160 C485 140, 545 150, 570 185 C590 215, 585 260, 550 275 C510 292, 450 280, 420 230 Z"
        fill="url(#land)"
        opacity="0.95"
      />
      {/* Sulawesi */}
      <path
        d="M620 230 C600 220, 600 200, 620 190 C640 180, 665 185, 675 200 C690 220, 675 245, 655 255 C640 262, 630 255, 620 230 Z"
        fill="url(#land)"
        opacity="0.95"
      />
      {/* Papua */}
      <path
        d="M720 250 C750 220, 820 220, 860 250 C890 270, 890 315, 860 330 C820 350, 750 345, 720 320 C695 300, 695 275, 720 250 Z"
        fill="url(#land)"
        opacity="0.95"
      />

      {/* Grid overlay */}
      <g opacity="0.08">
        {Array.from({ length: 10 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1="0"
            y1={(i * height) / 10}
            x2={width}
            y2={(i * height) / 10}
            stroke="#ffffff"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`v-${i}`}
            x1={(i * width) / 12}
            y1="0"
            x2={(i * width) / 12}
            y2={height}
            stroke="#ffffff"
            strokeWidth="1"
          />
        ))}
      </g>
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: 24,
    background: '#0b1220',
    minHeight: '100vh',
    color: '#e5e7eb',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 900,
    margin: 0,
  },
  subtitle: {
    margin: '8px 0 0',
    color: '#9ca3af',
  },
  headerRight: {
    textAlign: 'right',
    color: '#9ca3af',
    fontSize: 12,
  },
  headerRightLabel: {},
  headerRightValue: {
    color: '#e5e7eb',
    fontWeight: 800,
    fontSize: 13,
    marginTop: 6,
  },

  kpiGrid: {
    marginTop: 20,
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 12,
  },
  kpi: {
    padding: 14,
    borderRadius: 12,
    border: '1px solid #1f2937',
  },
  kpiTitle: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: 800,
  },
  kpiValue: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: 900,
  },

  mainGrid: {
    marginTop: 16,
    display: 'grid',
    gridTemplateColumns: '1.35fr 1fr',
    gap: 16,
    alignItems: 'start',
  },
  panel: {
    border: '1px solid #1f2937',
    borderRadius: 14,
    padding: 14,
    background: '#0b1220',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  panelTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
  },
  badge: {
    fontSize: 12,
    color: '#9ca3af',
    border: '1px solid #1f2937',
    padding: '4px 8px',
    borderRadius: 999,
    background: '#0a1020',
  },

  mapWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #1f2937',
    background: '#070c16',
    position: 'relative',
    width: '100%',
    height: MAP_H,
    maxWidth: '100%',
  },
  footnote: {
    marginTop: 10,
    marginBottom: 0,
    color: '#9ca3af',
    fontSize: 12,
  },

  listWrap: {
    marginTop: 12,
    maxHeight: MAP_H + 40,
    overflow: 'auto',
  },
  empty: {
    color: '#9ca3af',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'grid',
    gap: 10,
  },
  item: {
    border: '1px solid #1f2937',
    borderRadius: 12,
    padding: 12,
    background: '#0a1020',
  },
  itemTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'baseline',
  },
  itemIp: {
    fontWeight: 900,
  },
  itemMeta: {
    fontWeight: 700,
    color: '#9ca3af',
  },
  status: {
    fontWeight: 900,
  },
  cmd: {
    marginTop: 8,
    color: '#cbd5e1',
  },
  cmdLabel: {
    color: '#9ca3af',
    fontWeight: 800,
  },
  cmdMono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
  },
  itemBottom: {
    marginTop: 8,
    color: '#9ca3af',
    fontSize: 12,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },

  legend: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    color: '#9ca3af',
    fontSize: 12,
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    display: 'inline-block',
  },
};
