// ws-client.js - WebSocket connection manager

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${protocol}//${window.location.host}/ws`;
let ws = null;
let reconnectTimer = null;
let lastTelemetry = null;
let lastTelemetryReceivedAt = 0;
let linkState = "connecting";
let clientId = null;
let clientRole = "observer";
let controllerId = null;

function wsConnect() {
  setConnStatus("connecting");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnStatus("connected");
    addLog("WebSocket connected to backend");
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "telemetry") {
        lastTelemetry = msg;
        lastTelemetryReceivedAt = Date.now();
        if (msg.session) updateSession(msg.session);
        if (typeof onTelemetry === "function") onTelemetry(msg);
      } else if (msg.type === "session") {
        updateSession(msg);
      } else if (msg.type === "event") {
        handleBackendEvent(msg);
      }
    } catch (err) {
      addLog("Dropped malformed telemetry packet");
    }
  };

  ws.onclose = () => {
    setConnStatus("reconnecting");
    addLog("Connection lost - retrying in 2s");
    reconnectTimer = setTimeout(wsConnect, 2000);
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function updateSession(session) {
  clientId = session.client_id || clientId;
  clientRole = session.role || clientRole;
  controllerId = session.controller_id || null;
  document.body.classList.toggle("role-controller", clientRole === "controller");
  document.body.classList.toggle("role-observer", clientRole !== "controller");

  const inputSource = document.getElementById("input-source");
  if (inputSource && clientRole !== "controller") {
    inputSource.textContent = "OBSERVER MODE";
  }
}

function apiHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(clientId ? { "X-Client-Id": clientId } : {}),
    ...extra,
  };
}

function apiFetch(url, options = {}) {
  const method = options.method || "GET";
  const headers = method === "GET" ? (options.headers || {}) : apiHeaders(options.headers || {});
  return fetch(url, { ...options, headers });
}

function handleBackendEvent(msg) {
  if (!msg.ok && msg.error) {
    addLog(`${msg.event || "Backend"}: ${msg.error}`);
    if (msg.event === "autonomous_denied" && typeof syncModeButtons === "function") {
      syncModeButtons("manual");
    }
  } else if (msg.event === "control_denied") {
    addLog("Observer mode - control is held by another client");
  } else if (msg.event === "estop_release" && msg.ok) {
    addLog("E-stop release accepted by backend");
  }
}

function setConnStatus(state) {
  if (typeof state === "boolean") state = state ? "connected" : "offline";
  linkState = state;

  const dot = document.getElementById("conn-dot");
  const label = document.getElementById("conn-label");
  const camLink = document.getElementById("cam-link");
  if (!dot || !label) return;

  dot.className = `conn-indicator ${state}`;
  label.className = `conn-label ${state}`;

  const labels = {
    connecting: "CONNECTING",
    connected: "CONNECTED",
    stale: "STALE",
    reconnecting: "RECONNECTING",
    offline: "OFFLINE",
  };
  label.textContent = labels[state] || "UNKNOWN";
  if (camLink) camLink.textContent = labels[state] || "UNKNOWN";
}

function formatTelemetryAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-- ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function refreshTelemetryAge() {
  const age = lastTelemetryReceivedAt ? Date.now() - lastTelemetryReceivedAt : Infinity;
  const text = formatTelemetryAge(age);

  const ageEl = document.getElementById("conn-age");
  const camAge = document.getElementById("cam-age");
  if (ageEl) ageEl.textContent = text;
  if (camAge) camAge.textContent = text;

  if (ws && ws.readyState === WebSocket.OPEN) {
    if (age > 1500) setConnStatus("stale");
    else if (linkState !== "connected") setConnStatus("connected");
  }
}

// Log ring buffer
const LOG_MAX = 80;
const logRing = [];
function addLog(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  logRing.push(`[${ts}] ${msg}`);
  if (logRing.length > LOG_MAX) logRing.shift();

  const el = document.getElementById("log-msg");
  if (el) el.textContent = logRing[logRing.length - 1];
  renderLogDrawer();
}

function renderLogDrawer() {
  const list = document.getElementById("log-drawer-list");
  if (!list) return;
  list.innerHTML = logRing
    .slice()
    .reverse()
    .map((entry) => `<div class="log-line">${entry}</div>`)
    .join("");
}

function toggleLogDrawer() {
  const drawer = document.getElementById("log-drawer");
  if (drawer) drawer.classList.toggle("open");
}

// Clock
function updateClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toTimeString().slice(0, 8);
}

setInterval(updateClock, 1000);
setInterval(refreshTelemetryAge, 250);
updateClock();
wsConnect();
