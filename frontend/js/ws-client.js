// ws-client.js — WebSocket connection manager

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${protocol}//${window.location.host}/ws`;
let ws = null;
let reconnectTimer = null;
let lastTelemetry = null;

function wsConnect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnStatus(true);
    addLog("WebSocket connected to backend");
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "telemetry") {
        lastTelemetry = msg;
        onTelemetry(msg);
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    setConnStatus(false);
    addLog("Connection lost — retrying in 2s...");
    reconnectTimer = setTimeout(wsConnect, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function setConnStatus(connected) {
  const dot = document.getElementById("conn-dot");
  const label = document.getElementById("conn-label");
  if (connected) {
    dot.className = "conn-indicator connected";
    label.className = "conn-label connected";
    label.textContent = "CONNECTED";
  } else {
    dot.className = "conn-indicator error";
    label.className = "conn-label";
    label.textContent = "DISCONNECTED";
  }
}

// Log ring buffer
const LOG_MAX = 60;
const logRing = [];
function addLog(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  logRing.push(`[${ts}] ${msg}`);
  if (logRing.length > LOG_MAX) logRing.shift();
  const el = document.getElementById("log-msg");
  if (el) el.textContent = logRing[logRing.length - 1];
}

// Clock
function updateClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toTimeString().slice(0, 8);
}
setInterval(updateClock, 1000);
updateClock();

// Init
wsConnect();
