'use client';

import { useEffect, useState, useRef } from 'react';

type AuthAttempt = {
  id: number;
  src_ip: string;
  username: string;
  password: string;
  success: boolean;
  ts: string;
};

type Stats = {
  totalAttempts: number;
  successRate: number;
  uniqueIPs: number;
  recentAttempts: AuthAttempt[];
};

export default function Page() {
  const [stats, setStats] = useState<Stats>({
    totalAttempts: 0,
    successRate: 0,
    uniqueIPs: 0,
    recentAttempts: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const connectToLiveStream = () => {
    // tutup koneksi lama jika ada
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/attacks/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const newData: AuthAttempt[] = JSON.parse(event.data);
        if (newData.length === 0) return;

        setStats((prev) => {
          const allAttempts = [...prev.recentAttempts, ...newData];

          const totalAttempts = allAttempts.length;
          const successful = allAttempts.filter(a => a.success).length;
          const successRate =
            totalAttempts > 0 ? (successful / totalAttempts) * 100 : 0;
          const uniqueIPs = new Set(allAttempts.map(a => a.src_ip)).size;

          return {
            totalAttempts,
            successRate: Math.round(successRate * 100) / 100,
            uniqueIPs,
            recentAttempts: allAttempts.slice(-20), // simpan 20 terakhir
          };
        });
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    es.onerror = (err) => {
      console.error('SSE connection error:', err);
      es.close();
    };
  };

  useEffect(() => {
    connectToLiveStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <main className="dashboard-main">
      <h1 className="dashboard-title">Honeynet Dashboard (LIVE)</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Attempts</h3>
          <p>{stats.totalAttempts}</p>
        </div>

        <div className="stat-card">
          <h3>Success Rate</h3>
          <p>{stats.successRate}%</p>
        </div>

        <div className="stat-card">
          <h3>Unique IPs</h3>
          <p>{stats.uniqueIPs}</p>
        </div>
      </div>

      <h2 className="recent-title">Recent Attempts</h2>

      <div className="recent-container">
        {stats.recentAttempts.length === 0 ? (
          <p style={{ textAlign: 'center', margin: 0 }}>
            No attempts yet...
          </p>
        ) : (
          <ul className="recent-list">
            {stats.recentAttempts.map((attempt, index) => (
              <li key={index} className="attempt-item">
                <span>
                  <strong>{attempt.src_ip}</strong> —{' '}
                  {attempt.username}:{attempt.password}
                </span>

                <span
                  className={
                    attempt.success
                      ? 'attempt-success'
                      : 'attempt-fail'
                  }
                >
                  {attempt.success ? '✓' : '✗'}
                </span>

                <span className="attempt-time">
                  {new Date(attempt.ts).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
