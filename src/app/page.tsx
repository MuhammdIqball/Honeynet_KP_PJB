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
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [isReplayIndicator, setIsReplayIndicator] = useState(false);
  const lastDataTime = useRef(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);

  const connectToStream = (url: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    eventSourceRef.current = new EventSource(url);

    eventSourceRef.current.onmessage = (event) => {
      try {
        const newData: AuthAttempt[] = JSON.parse(event.data);
        if (newData.length > 0) {
          lastDataTime.current = Date.now();
          setMode('live');
          setIsReplayIndicator(false);
          setStats((prev) => {
            const allAttempts = [...prev.recentAttempts, ...newData];
            const totalAttempts = allAttempts.length;
            const successful = allAttempts.filter(a => a.success).length;
            const successRate = totalAttempts > 0 ? (successful / totalAttempts) * 100 : 0;
            const uniqueIPs = new Set(allAttempts.map(a => a.src_ip)).size;
            const recentAttempts = allAttempts.slice(-20); // keep last 20

            return {
              totalAttempts,
              successRate: Math.round(successRate * 100) / 100,
              uniqueIPs,
              recentAttempts,
            };
          });
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    eventSourceRef.current.onerror = (err) => {
      console.error('SSE error:', err);
    };
  };

  useEffect(() => {
    connectToStream('/api/attacks/stream');

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastDataTime.current > 30000) { // 30 seconds
        if (mode !== 'replay') {
          setMode('replay');
          setIsReplayIndicator(true);
          connectToStream('/api/attacks/replay');
        }
      }
    }, 5000); // check every 5s

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  return (
    <main className="dashboard-main">
      <h1 className="dashboard-title">Honeynet Dashboard</h1>
      {isReplayIndicator && (
        <div className="replay-indicator">
          REPLAY MODE
        </div>
      )}
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
          <p style={{ textAlign: 'center', margin: 0 }}>No attempts yet...</p>
        ) : (
          <ul className="recent-list">
            {stats.recentAttempts.map((attempt, index) => (
              <li key={index} className="attempt-item">
                <span><strong>{attempt.src_ip}</strong> - {attempt.username}:{attempt.password}</span>
                <span className={attempt.success ? 'attempt-success' : 'attempt-fail'}>
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
