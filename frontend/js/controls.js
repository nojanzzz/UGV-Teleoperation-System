// controls.js - Keyboard + Gamepad input handler

const keys = { w: false, a: false, s: false, d: false };
let throttle = 0;
let steering = 0;
let currentMode = "manual";
let isEstop = false;

const KEY_MAP = {
  w: "w",
  ArrowUp: "w",
  s: "s",
  ArrowDown: "s",
  a: "a",
  ArrowLeft: "a",
  d: "d",
  ArrowRight: "d",
};

document.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Escape") {
    e.preventDefault();
    if (!e.repeat) sendEstop();
    return;
  }
  const k = KEY_MAP[e.key];
  if (k && !keys[k]) {
    keys[k] = true;
    sendCurrentManualInput("keyboard");
  }
});

document.addEventListener("keyup", (e) => {
  const k = KEY_MAP[e.key];
  if (k) {
    keys[k] = false;
    sendCurrentManualInput("keyboard");
  }
});

function updateDpadFromVector(thr, str) {
  document.getElementById("key-w")?.classList.toggle("active", thr > 0.1);
  document.getElementById("key-s")?.classList.toggle("active", thr < -0.1);
  document.getElementById("key-a")?.classList.toggle("active", str < -0.1);
  document.getElementById("key-d")?.classList.toggle("active", str > 0.1);
}

function computeInputFromKeys() {
  let t = 0;
  let st = 0;
  if (keys.w) t = 1;
  if (keys.s) t = -1;
  if (keys.a) st = -1;
  if (keys.d) st = 1;
  return { throttle: t, steering: st };
}

window.addEventListener("gamepadconnected", (e) => {
  addLog(`Gamepad connected: ${e.gamepad.id}`);
});

window.addEventListener("gamepaddisconnected", () => {
  addLog("Gamepad disconnected");
});

function getGamepadInput() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    const steer = pad.axes[0] || 0;
    const thr = -(pad.axes[1] || 0);
    if (pad.buttons[0]?.pressed) sendEstop();
    const dead = 0.1;
    return {
      throttle: Math.abs(thr) > dead ? thr : 0,
      steering: Math.abs(steer) > dead ? steer : 0,
    };
  }
  return null;
}

setInterval(() => {
  if (isEstop || currentMode !== "manual" || clientRole !== "controller") return;

  sendCurrentManualInput();
}, 33);

function sendCurrentManualInput(preferredSource = "keyboard") {
  if (isEstop || currentMode !== "manual" || clientRole !== "controller") {
    updateInputDisplay(throttle, steering, preferredSource);
    return;
  }

  const gp = getGamepadInput();
  const kp = computeInputFromKeys();
  const gamepadActive = gp && (Math.abs(gp.throttle) > 0 || Math.abs(gp.steering) > 0);
  const source = gamepadActive ? "gamepad" : preferredSource;

  throttle = gamepadActive ? gp.throttle : kp.throttle;
  steering = gamepadActive ? gp.steering : kp.steering;

  wsSend({ type: "command", cmd: { throttle, steering } });
  updateInputDisplay(throttle, steering, source);
}

function updateInputDisplay(thr, str, source = "keyboard") {
  updateActuatorBars(thr, str);
  updateDpadFromVector(thr, str);

  const inputSource = document.getElementById("input-source");
  if (inputSource) {
    const active = Math.abs(thr) > 0.05 || Math.abs(str) > 0.05;
    inputSource.textContent = active ? `${source.toUpperCase()} ACTIVE` : `${source.toUpperCase()} READY`;
  }

  const dot = document.getElementById("vector-dot");
  if (dot) {
    dot.style.left = `${50 + str * 42}%`;
    dot.style.top = `${50 - thr * 42}%`;
    dot.classList.toggle("active", Math.abs(thr) > 0.05 || Math.abs(str) > 0.05);
  }
}

function updateActuatorBars(thr, str) {
  const tEl = document.getElementById("bar-throttle");
  const tVal = document.getElementById("val-throttle");
  if (tEl) {
    tEl.style.width = Math.abs(thr) * 100 + "%";
    tEl.style.background = thr >= 0 ? "var(--accent2)" : "var(--warn)";
  }
  if (tVal) tVal.textContent = thr.toFixed(2);

  const sEl = document.getElementById("bar-steering");
  const sVal = document.getElementById("val-steering");
  if (sEl) {
    const pct = Math.abs(str) * 50;
    sEl.style.width = pct + "%";
    sEl.style.left = str < 0 ? 50 - pct + "%" : "50%";
    sEl.style.background = "var(--accent)";
  }
  if (sVal) sVal.textContent = str.toFixed(2);
}

function syncModeButtons(mode) {
  currentMode = mode;
  document.body.classList.toggle("mode-auto", mode === "auto");
  document.body.classList.toggle("mode-manual", mode === "manual");
  document.getElementById("btn-manual")?.classList.toggle("active", mode === "manual");
  document.getElementById("btn-auto")?.classList.toggle("active", mode === "auto");
  const camMode = document.getElementById("cam-mode");
  if (camMode) camMode.textContent = mode === "auto" ? "AUTO" : "MANUAL";
}

function setMode(mode) {
  if (clientRole !== "controller") {
    addLog("Observer mode - control unavailable");
    return;
  }

  if (mode === "auto" && typeof getWaypointCount === "function" && getWaypointCount() === 0) {
    addLog("Add at least one waypoint before starting AUTONOMOUS mode");
    return;
  }

  syncModeButtons(mode);

  if (mode === "auto") {
    wsSend({ type: "autonomous", enabled: true });
    addLog("Switched to AUTONOMOUS mode");
  } else {
    wsSend({ type: "autonomous", enabled: false });
    wsSend({ type: "command", cmd: { throttle: 0, steering: 0 } });
    throttle = 0;
    steering = 0;
    updateInputDisplay(0, 0, "keyboard");
    addLog("Switched to MANUAL mode");
  }
}

function setEstopUi(active) {
  isEstop = active;
  document.body.classList.toggle("estop-active", active);
  const estopBtn = document.getElementById("estop-btn");
  const releaseBtn = document.getElementById("release-btn");
  const ov = document.getElementById("estop-overlay");
  if (estopBtn) estopBtn.style.display = active ? "none" : "block";
  if (releaseBtn) releaseBtn.style.display = active ? "block" : "none";
  if (ov) ov.classList.toggle("active", active);
}

function sendEstop() {
  if (isEstop) return;
  throttle = 0;
  steering = 0;
  updateInputDisplay(0, 0, "keyboard");
  setEstopUi(true);
  wsSend({ type: "estop" });
  wsSend({ type: "command", cmd: { throttle: 0, steering: 0 } });
  addLog("Emergency stop activated");
}

function recharge() {
  apiFetch("/api/battery/recharge", { method: "POST" })
    .then((r) => r.json())
    .then((d) => addLog(d.ok ? "Battery recharged to 100%" : `Recharge denied: ${d.error || "unknown error"}`))
    .catch(() => addLog("Battery recharge command failed"));
}

function releaseEstop() {
  if (clientRole !== "controller") {
    addLog("Observer mode - E-stop release denied");
    return;
  }
  throttle = 0;
  steering = 0;
  updateInputDisplay(0, 0, "keyboard");
  wsSend({ type: "estop_release" });
  addLog("E-stop release requested");
}

syncModeButtons("manual");
updateInputDisplay(0, 0, "keyboard");
