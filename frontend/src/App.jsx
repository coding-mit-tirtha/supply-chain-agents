import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL;

const SEVERITY = {
  critical: { color: "#EF4444", label: "Critical" },
  warning: { color: "#F5A623", label: "Warning" },
  info: { color: "#23D5C6", label: "Info" },
};

const AGENTS = [
  { role: "Demand Analyst", short: "DA" },
  { role: "Inventory Manager", short: "IM" },
  { role: "Supplier Risk Analyst", short: "SR" },
  { role: "Logistics Coordinator", short: "LC" },
];

function timeAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span className="dot" style={{ background: p.fill }} />
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
}

function SignalCard({ rec }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY[rec.severity] || SEVERITY.info;
  return (
    <div className="signal-card" style={{ borderLeftColor: sev.color }}>
      <div className="signal-top">
        <span className="tag category-tag">{rec.category}</span>
        <span className="signal-agent">{rec.agent_name}</span>
        <span className="signal-time">{timeAgo(rec.created_at)}</span>
      </div>
      <p className={`signal-message ${expanded ? "expanded" : ""}`}>
        {rec.message}
      </p>
      {rec.message?.length > 90 && (
        <button className="expand-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
      <div className="signal-bottom">
        <div className="signal-refs">
          {rec.product_sku && <span className="tag ref-tag">{rec.product_sku}</span>}
          {rec.supplier_name && <span className="tag ref-tag">{rec.supplier_name}</span>}
        </div>
        <span className="severity-badge" style={{ color: sev.color, borderColor: sev.color }}>
          {sev.label}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [filter, setFilter] = useState("all");

  const fetchRecommendations = async () => {
    try {
      const res = await axios.get(`${API_URL}/recommendations`);
      setRecommendations(res.data);
      if (res.data?.[0]?.created_at) setLastRun(res.data[0].created_at);
    } catch (e) {
      setError("Could not reach the API. Check that the backend is running.");
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const runAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_URL}/run-agents`);
      await fetchRecommendations();
    } catch (e) {
      setError("Agent run failed. Check the backend logs for details.");
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const s = { total: recommendations.length, critical: 0, warning: 0, info: 0 };
    recommendations.forEach((r) => { if (s[r.severity] !== undefined) s[r.severity]++; });
    return s;
  }, [recommendations]);

  const agentCounts = useMemo(() => {
    const counts = {};
    recommendations.forEach((r) => {
      counts[r.agent_name] = (counts[r.agent_name] || 0) + 1;
    });
    return counts;
  }, [recommendations]);

  const chartData = useMemo(() => {
    const byCategory = {};
    recommendations.forEach((r) => {
      byCategory[r.category] = byCategory[r.category] || { category: r.category, critical: 0, warning: 0, info: 0 };
      byCategory[r.category][r.severity]++;
    });
    return Object.values(byCategory);
  }, [recommendations]);

  const filtered = filter === "all"
    ? recommendations
    : recommendations.filter((r) => r.severity === filter);

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">SUPPLY CHAIN OPS</span>
        </div>
        <div className="topbar-right">
          <div className={`status-pill ${loading ? "busy" : "online"}`}>
            <span className="pulse-dot" />
            {loading ? "AGENTS RUNNING" : "SYSTEM ONLINE"}
          </div>
          <button className="run-btn" onClick={runAgents} disabled={loading}>
            {loading ? "Analyzing…" : "Run agents"}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-label">Total signals</span>
          <span className="kpi-value">{stats.total}</span>
        </div>
        <div className="kpi-card" style={{ "--accent": SEVERITY.critical.color }}>
          <span className="kpi-label">Critical</span>
          <span className="kpi-value">{stats.critical}</span>
        </div>
        <div className="kpi-card" style={{ "--accent": SEVERITY.warning.color }}>
          <span className="kpi-label">Warning</span>
          <span className="kpi-value">{stats.warning}</span>
        </div>
        <div className="kpi-card" style={{ "--accent": SEVERITY.info.color }}>
          <span className="kpi-label">Info</span>
          <span className="kpi-value">{stats.info}</span>
        </div>
        <div className="kpi-card kpi-time">
          <span className="kpi-label">Last run</span>
          <span className="kpi-value small">{lastRun ? timeAgo(lastRun) : "—"}</span>
        </div>
      </section>

      <section className="agent-rail">
        {AGENTS.map((a) => (
          <div key={a.role} className={`agent-card ${loading ? "active" : ""}`}>
            <div className="agent-avatar">{a.short}</div>
            <div className="agent-info">
              <span className="agent-role">{a.role}</span>
              <span className="agent-count">{agentCounts[a.role] || 0} signals</span>
            </div>
            <span className={`agent-dot ${loading ? "on" : ""}`} />
          </div>
        ))}
      </section>

      <section className="main-grid">
        <div className="panel chart-panel">
          <div className="panel-header">
            <h2>Signals by category</h2>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barCategoryGap={28}>
                <XAxis dataKey="category" stroke="#5B6478" tick={{ fontSize: 12, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#232B38" }} tickLine={false} />
                <YAxis stroke="#5B6478" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="critical" stackId="a" fill={SEVERITY.critical.color} radius={[0, 0, 0, 0]} />
                <Bar dataKey="warning" stackId="a" fill={SEVERITY.warning.color} />
                <Bar dataKey="info" stackId="a" fill={SEVERITY.info.color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel feed-panel">
          <div className="panel-header">
            <h2>Live signal feed</h2>
            <div className="filter-row">
              {["all", "critical", "warning", "info"].map((f) => (
                <button
                  key={f}
                  className={`filter-chip ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : SEVERITY[f].label}
                </button>
              ))}
            </div>
          </div>
          <div className="feed-list">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <p>No signals yet.</p>
                <span>Run the agents to generate live recommendations.</span>
              </div>
            ) : (
              filtered.map((r) => <SignalCard key={r.id} rec={r} />)
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
