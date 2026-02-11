import { useEffect, useState, useCallback } from 'react';
import './App.css';

interface Session {
  sessionId: string;
  sessionKey: string;
  label: string;
  model: string;
  totalTokens: number;
  totalCost: number;
  status: 'running' | 'completed' | 'failed' | 'idle';
  messageCount: number;
  lastUpdated: string;
  createdAt: string;
}

interface Stats {
  totalSessions: number;
  activeToday: number;
  totalTokens: number;
  totalCost: number;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [sessionsRes, statsRes] = await Promise.all([
        fetch('/api/sessions?activeMinutes=1440'), // Last 24 hours
        fetch('/api/stats'),
      ]);

      if (!sessionsRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const sessionsData = await sessionsRes.json();
      const statsData = await statsRes.json();

      setSessions(sessionsData.sessions || []);
      setStats(statsData);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  const activeAgents = sessions.filter(s => s.status === 'running').length;
  const completedAgents = sessions.filter(s => s.status === 'completed').length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">🔭 Agent Observatory</h1>
            <p className="text-gray-400 text-sm">
              Last refresh: {formatTime(lastRefresh.toISOString())}
            </p>
          </div>
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh
            </label>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="card mb-6 border-red-500/50 bg-red-900/20">
            <p className="text-red-400">⚠️ {error}</p>
            <p className="text-sm text-gray-400 mt-1">
              Make sure the server is running: <code className="bg-gray-800 px-1 rounded">npm run server</code>
            </p>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="card">
            <div className="text-3xl font-bold text-blue-400">{activeAgents}</div>
            <div className="text-sm text-gray-400">Active Now</div>
          </div>
          <div className="card">
            <div className="text-3xl font-bold text-green-400">{stats?.activeToday || 0}</div>
            <div className="text-sm text-gray-400">Sessions Today</div>
          </div>
          <div className="card">
            <div className="text-3xl font-bold text-purple-400">
              {formatTokens(stats?.totalTokens || 0)}
            </div>
            <div className="text-sm text-gray-400">Total Tokens</div>
          </div>
          <div className="card">
            <div className="text-3xl font-bold text-yellow-400">
              {formatCost(stats?.totalCost || 0)}
            </div>
            <div className="text-sm text-gray-400">Est. Cost</div>
          </div>
        </div>

        {/* Sessions Table */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Recent Sessions</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Label</th>
                  <th className="pb-3 pr-4">Model</th>
                  <th className="pb-3 pr-4 text-right">Tokens</th>
                  <th className="pb-3 pr-4 text-right">Cost</th>
                  <th className="pb-3 pr-4 text-right">Messages</th>
                  <th className="pb-3">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      No sessions found
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr 
                      key={session.sessionId} 
                      className="border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <span className={`badge badge-${session.status}`}>
                          {session.status === 'running' && '⚡ '}
                          {session.status === 'completed' && '✓ '}
                          {session.status === 'failed' && '✗ '}
                          {session.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{session.label}</div>
                        <div className="text-xs text-gray-500 font-mono truncate max-w-[200px]">
                          {session.sessionId.slice(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-sm text-gray-400">
                        {session.model.split('/').pop()?.split('-').slice(0, 2).join('-') || session.model}
                      </td>
                      <td className="py-3 pr-4 text-right text-purple-400">
                        {formatTokens(session.totalTokens)}
                      </td>
                      <td className="py-3 pr-4 text-right text-yellow-400">
                        {session.totalCost > 0 ? formatCost(session.totalCost) : '-'}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-400">
                        {session.messageCount}
                      </td>
                      <td className="py-3 text-sm text-gray-400">
                        <div>{getTimeAgo(session.lastUpdated)}</div>
                        <div className="text-xs text-gray-500">
                          {formatDate(session.lastUpdated)}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Token Usage by Session (Bar Chart) */}
        <div className="card mt-6">
          <h2 className="text-lg font-semibold mb-4">Token Usage by Session</h2>
          <div className="space-y-2">
            {sessions.slice(0, 10).map((session) => {
              const maxTokens = Math.max(...sessions.map(s => s.totalTokens), 1);
              const widthPercent = (session.totalTokens / maxTokens) * 100;
              
              return (
                <div key={session.sessionId} className="flex items-center gap-3">
                  <div className="w-32 text-sm text-gray-400 truncate">
                    {session.label}
                  </div>
                  <div className="flex-1 h-6 bg-gray-700 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        session.status === 'running' ? 'bg-blue-500' :
                        session.status === 'completed' ? 'bg-green-500' :
                        'bg-gray-500'
                      }`}
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                  <div className="w-20 text-right text-sm text-gray-400">
                    {formatTokens(session.totalTokens)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          Sessions stored in ~/.openclaw/agents/main/sessions/
        </div>
      </div>
    </div>
  );
}

export default App;
