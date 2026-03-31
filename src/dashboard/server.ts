/**
 * Dashboard server for X social automation.
 * Reads logs + state, serves UI, and provides control endpoints for the scheduler.
 *
 * Usage: npx tsx src/dashboard/server.ts
 * Then open http://localhost:3847
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";

const PORT = 3847;
const BASE = "C:\\Users\\Trent\\rep\\COMMAND CENTER\\Command Center\\SocialMediaEngine\\X";
const STATE_DIR = path.join(BASE, "state");
const REPLIES_DIR = path.join(BASE, "replies");
const CONTROL_PATH = path.join(STATE_DIR, "scheduler-control.json");
const STATUS_PATH = path.join(STATE_DIR, "scheduler-status.json");

// ── Data readers ──────────────────────────────────────────────────────────

function readJson(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch { return null; }
}

function readJsonl(filePath: string, maxLines = 200): any[] {
  try {
    return fs.readFileSync(filePath, "utf-8")
      .trim().split("\n").slice(-maxLines)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function readReplyLog(date: string): string {
  try { return fs.readFileSync(path.join(REPLIES_DIR, `${date}.md`), "utf-8"); }
  catch { return ""; }
}

function countReplies(md: string): number {
  return (md.match(/^## REPLY \[\d+\]/gm) ?? []).length;
}

function writeControl(data: any): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const existing = readJson(CONTROL_PATH) ?? {};
    fs.writeFileSync(CONTROL_PATH, JSON.stringify({ ...existing, ...data }, null, 2));
  } catch {}
}

function getApiData() {
  const inboundState = readJson(path.join(STATE_DIR, "x-inbound-state.json"));
  const outboundState = readJson(path.join(STATE_DIR, "x-outbound-state.json"));
  const schedulerStatus = readJson(STATUS_PATH);
  const schedulerControl = readJson(CONTROL_PATH);
  const costs = readJsonl(path.join(STATE_DIR, "x-costs.jsonl"));
  const scheduler = readJsonl(path.join(STATE_DIR, "scheduler.log"), 100);

  // Use local date for "today" so it matches the user's wall clock, not UTC
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayReplyMd = readReplyLog(today);
  const todayReplies = countReplies(todayReplyMd);

  // Match costs where the UTC timestamp falls on today's local date
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86_400_000;
  const todayCosts = costs.filter((c: any) => {
    const t = new Date(c.ts).getTime();
    return t >= todayStart && t < todayEnd;
  });
  const totalCostToday = todayCosts.reduce((s: number, c: any) => s + (c.costUsd ?? 0), 0);
  const totalCostAll = costs.reduce((s: number, c: any) => s + (c.costUsd ?? 0), 0);
  const totalInputTokens = costs.reduce((s: number, c: any) => s + (c.inputTokens ?? 0), 0);
  const totalOutputTokens = costs.reduce((s: number, c: any) => s + (c.outputTokens ?? 0), 0);

  const recentEvents = scheduler.slice(-30);

  const replyEntries: { to: string; text: string; time: string; verified: boolean }[] = [];
  const blocks = todayReplyMd.split(/^## REPLY \[\d+\]/m).slice(1);
  for (const block of blocks.slice(-20)) {
    const to = block.match(/\*\*To:\*\* @(\S+)/)?.[1] ?? "";
    const text = block.match(/\*\*Our response:\*\* "([^"]+)"/)?.[1] ?? "";
    const time = block.match(/\*\*Time:\*\* (\S+)/)?.[1] ?? "";
    const verified = block.includes("**Verified:** true");
    replyEntries.push({ to, text: text.slice(0, 120), time, verified });
  }

  return {
    inboundState,
    outboundState,
    schedulerStatus,
    schedulerControl,
    todayReplies,
    totalCostToday: +totalCostToday.toFixed(4),
    totalCostAll: +totalCostAll.toFixed(4),
    totalInputTokens,
    totalOutputTokens,
    recentEvents,
    replyEntries,
    costHistory: todayCosts,
  };
}

// ── HTML ──────────────────────────────────────────────────────────────────

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>X Automation Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #fff; }
  .subtitle { font-size: 0.8rem; color: #666; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #1a1a2e; border-radius: 10px; padding: 16px; border: 1px solid #2a2a3e; }
  .card-label { font-size: 0.7rem; text-transform: uppercase; color: #888; letter-spacing: 0.05em; margin-bottom: 4px; }
  .card-value { font-size: 1.6rem; font-weight: 700; color: #fff; }
  .green { color: #4ade80; }
  .blue { color: #60a5fa; }
  .amber { color: #fbbf24; }
  .red { color: #f87171; }
  .section { background: #1a1a2e; border-radius: 10px; padding: 16px; border: 1px solid #2a2a3e; margin-bottom: 16px; }
  .section h2 { font-size: 0.95rem; margin-bottom: 10px; color: #ccc; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; color: #888; font-weight: 500; }
  td { padding: 6px 10px; border-bottom: 1px solid #1f1f2f; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; }
  .badge-green { background: #064e3b; color: #4ade80; }
  .badge-red { background: #450a0a; color: #f87171; }
  .badge-blue { background: #1e3a5f; color: #60a5fa; }
  .badge-amber { background: #451a03; color: #fbbf24; }
  .log-line { font-family: monospace; font-size: 0.75rem; padding: 3px 0; color: #aaa; border-bottom: 1px solid #1f1f2f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  .controls button { border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: opacity 0.15s; }
  .controls button:hover { opacity: 0.85; }
  .btn-green { background: #16a34a; color: #fff; }
  .btn-red { background: #dc2626; color: #fff; }
  .btn-blue { background: #2563eb; color: #fff; }
  .btn-amber { background: #d97706; color: #fff; }
  .btn-gray { background: #374151; color: #e0e0e0; }
  .status-wrapper { margin-bottom: 16px; background: #1a1a2e; border-radius: 10px; border: 1px solid #2a2a3e; overflow: hidden; }
  .status-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot-running { background: #4ade80; box-shadow: 0 0 8px #4ade80; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .dot-waiting { background: #60a5fa; box-shadow: 0 0 8px #60a5fa; }
  .dot-paused { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
  .dot-offline { background: #666; }
  .status-text { font-size: 0.9rem; font-weight: 600; }
  .status-detail { font-size: 0.8rem; color: #888; flex: 1; }
  .btn-log-toggle { border: 1px solid #444; background: #2a2a3e; color: #ccc; padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 600; transition: all 0.15s; white-space: nowrap; }
  .btn-log-toggle:hover { background: #3a3a4e; border-color: #60a5fa; color: #fff; }
  .status-log-panel { border-top: 1px solid #2a2a3e; max-height: 350px; overflow-y: auto; font-family: monospace; font-size: 0.76rem; padding: 10px 16px; background: #0d0d1a; }
  .status-log-panel .log-entry { padding: 2px 0; border-bottom: 1px solid #1a1a2e; color: #ccc; }
  .refresh-note { font-size: 0.75rem; color: #555; }
</style>
</head>
<body>
<h1>X Automation Dashboard</h1>
<div class="subtitle">@hodlmecloseplz &middot; <span id="updated" class="refresh-note"></span></div>

<div class="status-wrapper">
  <div class="status-bar">
    <div class="status-dot" id="statusDot"></div>
    <span class="status-text" id="statusText">Loading...</span>
    <span class="status-detail" id="statusDetail"></span>
    <button class="btn-log-toggle" id="logToggle" style="display:none" onclick="toggleStatusLog()">Open Logs</button>
  </div>
  <div class="status-log-panel" id="statusLogPanel" style="display:none"></div>
</div>

<div class="controls">
  <button class="btn-green" onclick="action('resume')">Resume</button>
  <button class="btn-amber" onclick="action('pause')">Pause</button>
  <button class="btn-blue" onclick="action('trigger', 'outbound')">Run Outbound Now</button>
  <button class="btn-blue" onclick="action('trigger', 'inbound')">Run Inbound Now</button>
  <button class="btn-red" onclick="action('stop')">Stop Run</button>
  <button class="btn-gray" onclick="action('skip')">Skip Wait</button>
  <button class="btn-gray" onclick="refresh()">Refresh</button>
</div>

<div class="grid" id="stats"></div>

<div class="section">
  <h2>Recent Replies (Today)</h2>
  <table id="replies"><thead><tr><th>Time</th><th>To</th><th>Reply</th><th>Status</th></tr></thead><tbody></tbody></table>
</div>

<div class="section">
  <h2>Cost History (Today)</h2>
  <table id="costs"><thead><tr><th>Time</th><th>Mode</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th><th>Replies</th></tr></thead><tbody></tbody></table>
</div>

<div class="section" id="liveSection">
  <h2>Live Output <span class="badge badge-green" id="liveBadge">Tailing</span></h2>
  <div id="liveLog" style="max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 0.78rem; background: #0d0d1a; border-radius: 6px; padding: 10px;"></div>
</div>

<div class="section">
  <h2>Scheduler Log</h2>
  <div id="log" style="max-height: 300px; overflow-y: auto;"></div>
</div>

<script>
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeSince(ts) {
  if (!ts) return '-';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  return Math.round(mins / 60) + 'h ago';
}

let statusLogOpen = false;
let isRunning = false;

function toggleStatusLog() {
  statusLogOpen = !statusLogOpen;
  const panel = document.getElementById('statusLogPanel');
  const btn = document.getElementById('logToggle');
  panel.style.display = statusLogOpen ? '' : 'none';
  btn.textContent = statusLogOpen ? 'Close Logs' : 'Open Logs';
  if (statusLogOpen) pollLiveLog(); // immediate fetch
}

async function action(type, mode) {
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: type, mode })
  });
  if (type === 'trigger') {
    // Auto-open the log panel when triggering a run
    statusLogOpen = true;
    document.getElementById('statusLogPanel').style.display = '';
    document.getElementById('logToggle').textContent = 'Close Logs';
    document.getElementById('statusLogPanel').innerHTML = '<div class="log-entry" style="color:#888">Starting...</div>';
  }
  setTimeout(refresh, 500);
  setTimeout(pollLiveLog, 1000);
}

async function refresh() {
  const res = await fetch('/api/data');
  const d = await res.json();
  document.getElementById('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

  // Status bar — derive state from: activeJob > logStatus > schedulerStatus file
  const job = d.activeJob;
  const ls = d.logStatus;
  const st = d.schedulerStatus;
  const dot = document.getElementById('statusDot');
  const stText = document.getElementById('statusText');
  const stDetail = document.getElementById('statusDetail');
  const logToggle = document.getElementById('logToggle');

  if (job && job.running) {
    // Dashboard-spawned process is running
    isRunning = true;
    dot.className = 'status-dot dot-running';
    stText.textContent = 'Running';
    stDetail.textContent = job.mode + ' \u2022 started ' + formatTime(job.startedAt);
  } else if (ls && ls.state === 'running') {
    // Log file shows active writes — something is running (scheduler or external)
    isRunning = true;
    dot.className = 'status-dot dot-running';
    stText.textContent = 'Running';
    const detail = (ls.mode ?? '') + ' \u2022 ' + (ls.lastEvent ?? 'in progress');
    stDetail.textContent = ls.lastTs ? detail + ' \u2022 ' + timeSince(ls.lastTs) : detail;
  } else if (st && st.state === 'waiting') {
    isRunning = false;
    dot.className = 'status-dot dot-waiting';
    stText.textContent = 'Waiting';
    stDetail.textContent = st.nextRunAt ? 'next ' + st.nextMode + ' at ' + formatTime(st.nextRunAt) : '';
  } else if (st && st.state === 'paused') {
    isRunning = false;
    dot.className = 'status-dot dot-paused';
    stText.textContent = 'Paused';
    stDetail.textContent = 'Click Resume to continue';
  } else {
    isRunning = false;
    dot.className = 'status-dot dot-offline';
    const lastInfo = ls?.lastEvent ? ls.lastEvent + (ls.lastTs ? ' \u2022 ' + timeSince(ls.lastTs) : '') : '';
    stText.textContent = 'Idle';
    stDetail.textContent = lastInfo || (st?.lastCompleted ? 'Last: ' + st.lastCompleted : 'Ready');
  }

  // Show toggle button — always visible so you can check logs even when idle
  logToggle.style.display = '';
  logToggle.textContent = statusLogOpen ? 'Close Logs' : 'Open Logs';

  // Stats grid
  document.getElementById('stats').innerHTML = [
    { label: 'Replies Today', value: d.todayReplies, cls: 'green' },
    { label: 'Inbound', value: d.inboundState?.total_replies_posted_today ?? 0, cls: 'blue' },
    { label: 'Outbound', value: d.outboundState?.total_replies_posted_today ?? 0, cls: 'blue' },
    { label: 'Cost Today', value: '$' + d.totalCostToday.toFixed(4), cls: 'amber' },
    { label: 'Cost All Time', value: '$' + d.totalCostAll.toFixed(4), cls: 'amber' },
    { label: 'Tokens In / Out', value: (d.totalInputTokens/1000).toFixed(1) + 'k / ' + (d.totalOutputTokens/1000).toFixed(1) + 'k', cls: '' },
    { label: 'Inbound Mode', value: d.inboundState?.mode ?? '-', cls: d.inboundState?.mode === 'aggressive' ? 'green' : '' },
  ].map(s => '<div class="card"><div class="card-label">' + s.label + '</div><div class="card-value ' + s.cls + '">' + s.value + '</div></div>').join('');

  // Replies table
  document.querySelector('#replies tbody').innerHTML = d.replyEntries.slice().reverse().map(r =>
    '<tr><td>' + formatTime(r.time) + '</td><td>@' + r.to + '</td><td>' + r.text + '</td><td>' +
    (r.verified ? '<span class="badge badge-green">Verified</span>' : '<span class="badge badge-red">Unverified</span>') + '</td></tr>'
  ).join('') || '<tr><td colspan="4" style="color:#555">No replies yet today</td></tr>';

  // Cost table
  document.querySelector('#costs tbody').innerHTML = d.costHistory.slice().reverse().map(c =>
    '<tr><td>' + formatTime(c.ts) + '</td><td><span class="badge badge-blue">' + (c.mode ?? '-') + '</span></td><td>' +
    (c.inputTokens ?? 0).toLocaleString() + '</td><td>' + (c.outputTokens ?? 0).toLocaleString() + '</td><td>$' + (c.costUsd ?? 0).toFixed(4) +
    '</td><td>' + (c.replies ?? 0) + '</td></tr>'
  ).join('') || '<tr><td colspan="6" style="color:#555">No cost data yet today</td></tr>';

  // Log
  document.getElementById('log').innerHTML = d.recentEvents.slice().reverse().map(e =>
    '<div class="log-line">' + formatTime(e.ts) + ' <span style="color:#60a5fa">[' + (e.event ?? '') + ']</span> ' +
    JSON.stringify(e).slice(0, 160) + '</div>'
  ).join('') || '<div class="log-line">No events yet</div>';
}

function colorizeLogLine(raw) {
  try {
    const obj = JSON.parse(raw);
    const time = formatTime(obj.ts);
    const ev = obj.event ?? '';
    let evColor = '#60a5fa';
    if (ev.includes('error') || ev.includes('failed')) evColor = '#f87171';
    else if (ev.includes('ok') || ev.includes('done') || ev.includes('verified') || ev.includes('deleted') || ev.includes('complete')) evColor = '#4ade80';
    else if (ev.includes('skip') || ev.includes('abort')) evColor = '#fbbf24';
    else if (ev.includes('generated') || ev.includes('start')) evColor = '#c084fc';

    const parts = [time, '<span style="color:' + evColor + '">[' + ev + ']</span>'];
    if (obj.handle) parts.push('@' + obj.handle);
    if (obj.mode) parts.push(obj.mode);
    if (obj.replyText) parts.push('"' + obj.replyText.slice(0, 80) + (obj.replyText.length > 80 ? '...' : '') + '"');
    if (obj.query) parts.push(obj.query);
    if (obj.chars) parts.push(obj.chars + ' chars');
    if (obj.submitted !== undefined) parts.push(obj.submitted ? '<span style="color:#4ade80">submitted</span>' : '<span style="color:#f87171">not submitted</span>');
    if (obj.verified !== undefined) parts.push(obj.verified ? '<span style="color:#4ade80">verified</span>' : '<span style="color:#f87171">unverified</span>');
    if (obj.costUsd) parts.push('$' + obj.costUsd.toFixed(4));
    if (obj.error) parts.push('<span style="color:#f87171">' + obj.error.slice(0, 80) + '</span>');
    if (obj.count !== undefined) parts.push('count: ' + obj.count);
    if (obj.reason) parts.push(obj.reason);
    return parts.join(' ');
  } catch {
    return '<span style="color:#888">' + raw + '</span>';
  }
}

async function pollLiveLog() {
  try {
    const res = await fetch('/api/live-log');
    const d = await res.json();

    // Update the bottom Live Output section
    const badge = document.getElementById('liveBadge');
    const container = document.getElementById('liveLog');

    if (d.running) {
      badge.textContent = 'Running';
      badge.className = 'badge badge-green';
    } else if (d.lines.length > 0) {
      badge.textContent = 'Server Log';
      badge.className = 'badge badge-blue';
    } else {
      badge.textContent = 'No Logs';
      badge.className = 'badge badge-amber';
    }

    const rendered = d.lines.map(l =>
      '<div class="log-entry">' + colorizeLogLine(l) + '</div>'
    ).join('') || '<div class="log-entry" style="color:#555">No log output yet</div>';

    const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;
    container.innerHTML = rendered;
    if (wasAtBottom) container.scrollTop = container.scrollHeight;

    // Also populate the status bar log panel if open
    if (statusLogOpen) {
      const panel = document.getElementById('statusLogPanel');
      const panelWasAtBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 30;
      panel.innerHTML = rendered;
      if (panelWasAtBottom) panel.scrollTop = panel.scrollHeight;
    }
  } catch {}
}

refresh();
setInterval(refresh, 10000);
pollLiveLog();
setInterval(pollLiveLog, isRunning ? 2000 : 3000);
// Poll faster when running
setInterval(() => { if (isRunning) pollLiveLog(); }, 2000);
</script>
</body>
</html>`;
}

// ── Process spawning ──────────────────────────────────────────────────────

const PROJECT_DIR = "C:\\Users\\Trent\\rep\\social-automation";
const MAX_LIVE_LINES = 200;
let activeJob: { mode: string; proc: ChildProcess; startedAt: string } | null = null;
let liveLog: string[] = []; // In-memory ring buffer of the current run's output

function getActiveJobStatus(): { running: boolean; mode: string | null; startedAt: string | null } {
  if (!activeJob) return { running: false, mode: null, startedAt: null };
  if (activeJob.proc.exitCode !== null) {
    activeJob = null;
    return { running: false, mode: null, startedAt: null };
  }
  return { running: true, mode: activeJob.mode, startedAt: activeJob.startedAt };
}

function spawnRun(mode: "outbound" | "inbound"): { ok: boolean; error?: string } {
  const job = getActiveJobStatus();
  if (job.running) {
    return { ok: false, error: `Already running: ${job.mode}` };
  }

  const script = mode === "outbound"
    ? "src/x/outbound-engagement.ts"
    : "src/x/inbound-engagement.ts";

  const logFile = path.join(STATE_DIR, "scheduler.log");

  const proc = spawn("npx", ["tsx", script], {
    cwd: PROJECT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  // Clear live log for new run
  liveLog = [];

  // Capture output to both file and in-memory buffer
  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  const captureOutput = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    stream.pipe(logStream);
    let partial = "";
    stream.on("data", (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          liveLog.push(line);
          if (liveLog.length > MAX_LIVE_LINES) liveLog.shift();
        }
      }
    });
  };

  captureOutput(proc.stdout);
  captureOutput(proc.stderr);

  proc.on("close", (code) => {
    liveLog.push(JSON.stringify({ ts: new Date().toISOString(), event: "process_exit", code }));
    activeJob = null;
    const statusData = { ts: new Date().toISOString(), state: "idle", lastCompleted: mode };
    try { fs.writeFileSync(STATUS_PATH, JSON.stringify(statusData, null, 2)); } catch {}
  });

  activeJob = { mode, proc, startedAt: new Date().toISOString() };

  const statusData = { ts: new Date().toISOString(), state: "running", mode };
  try { fs.writeFileSync(STATUS_PATH, JSON.stringify(statusData, null, 2)); } catch {}

  return { ok: true };
}

// ── Log-derived status ───────────────────────────────────────────────────

const RUN_TERMINAL_EVENTS = new Set(["session_complete", "process_exit", "next_run"]);

function deriveStatusFromLog(): { state: string; mode: string | null; lastEvent: string | null; lastTs: string | null } {
  const logFile = path.join(STATE_DIR, "scheduler.log");
  try {
    const stat = fs.statSync(logFile);
    const logFresh = Date.now() - stat.mtimeMs < 15_000; // written to in last 15s

    const raw = fs.readFileSync(logFile, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);

    // Walk backwards to find the last parseable event
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (!entry.event) continue;

        if (RUN_TERMINAL_EVENTS.has(entry.event)) {
          return { state: "idle", mode: entry.mode ?? null, lastEvent: entry.event, lastTs: entry.ts ?? null };
        }

        // Non-terminal event — if the log is fresh, we're still running
        if (logFresh) {
          return { state: "running", mode: entry.mode ?? null, lastEvent: entry.event, lastTs: entry.ts ?? null };
        }

        // Log is stale but last event wasn't terminal — probably crashed or finished without clean exit
        return { state: "idle", mode: entry.mode ?? null, lastEvent: entry.event, lastTs: entry.ts ?? null };
      } catch {}
    }
  } catch {}

  return { state: "idle", mode: null, lastEvent: null, lastTs: null };
}

// ── HTTP Server ───────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url === "/api/data" && req.method === "GET") {
    const data = getApiData();
    const job = getActiveJobStatus();
    const logStatus = deriveStatusFromLog();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...data, activeJob: job, logStatus }));

  } else if (url === "/api/live-log" && req.method === "GET") {
    const job = getActiveJobStatus();
    let lines: string[];
    let running: boolean;
    if (job.running) {
      // Active dashboard-spawned job — show its live output
      lines = liveLog;
      running = true;
    } else {
      // No active job — tail the scheduler.log file so we always show server output
      const logFile = path.join(STATE_DIR, "scheduler.log");
      try {
        const raw = fs.readFileSync(logFile, "utf-8");
        lines = raw.trim().split("\n").slice(-MAX_LIVE_LINES).filter(Boolean);
      } catch {
        lines = [];
      }
      running = false;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ lines, running }));

  } else if (url === "/api/control" && req.method === "POST") {
    const body = await parseBody(req);
    const action = body.action;
    let result: any = { ok: true, action };

    if (action === "pause") {
      writeControl({ paused: true });
    } else if (action === "resume") {
      writeControl({ paused: false });
    } else if (action === "trigger") {
      const mode = body.mode === "inbound" ? "inbound" : "outbound";
      result = { action, ...spawnRun(mode) };
    } else if (action === "skip") {
      writeControl({ skipWait: true });
    } else if (action === "stop") {
      if (activeJob?.proc) {
        activeJob.proc.kill();
        activeJob = null;
        result = { ok: true, action: "stopped" };
      } else {
        result = { ok: false, error: "Nothing running" };
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));

  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderHtml());
  }
});

server.listen(PORT, () => {
  console.log(`[dashboard] Running at http://localhost:${PORT}`);
});
