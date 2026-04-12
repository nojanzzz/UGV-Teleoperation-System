// controls.js — Keyboard + Gamepad input handler

const keys = { w: false, a: false, s: false, d: false };
let throttle = 0;
let steering = 0;
let currentMode = "manual";
let isEstop = false;

// Key → action mapping
const KEY_MAP = {
  "w": "w", "ArrowUp": "w",
  "s": "s", "ArrowDown": "s",
  "a": "a", "ArrowLeft": "a",
  "d": "d", "ArrowRight": "d",
};

document.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Escape") {
    e.preventDefault();
    sendEstop();
    return;
  }
  const k = KEY_MAP[e.key];
  if (k && !keys[k]) {
    keys[k] = true;
    updateDpad();
  }
});

document.addEventListener("keyup", (e) => {
  const k = KEY_MAP[e.key];
  if (k) {
    keys[k] = false;
    updateDpad();
  }
});

function updateDpad() {
  document.getElementById("key-w").classList.toggle("active", keys.w);
  document.getElementById("key-s").classList.toggle("active", keys.s);
  document.getElementById("key-a").classList.toggle("active", keys.a);
  document.getElementById("key-d").classList.toggle("active", keys.d);
}

// Compute throttle/steering from held keys
function computeInputFromKeys() {
  let t = 0, st = 0;
  if (keys.w) t = 1;
  if (keys.s) t = -1;
  if (keys.a) st = -1;
  if (keys.d) st = 1;
  return { throttle: t, steering: st };
}

// Gamepad polling
let gamepads = {};
window.addEventListener("gamepadconnected", (e) => {
  gamepads[e.gamepad.index] = e.gamepad;
  addLog(`Gamepad connected: ${e.gamepad.id}`);
});
window.addEventListener("gamepaddisconnected", (e) => {
  delete gamepads[e.gamepad.index];
  addLog("Gamepad disconnected");
});

function getGamepadInput() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    // Left stick: axis 0 = steering, axis 1 = throttle (inverted)
    const steer = pad.axes[0] || 0;
    const thr   = -(pad.axes[1] || 0);
    // Button 0 = A = E-STOP (hold)
    if (pad.buttons[0]?.pressed) sendEstop();
    const dead = 0.1;
    return {
      throttle: Math.abs(thr) > dead ? thr : 0,
      steering: Math.abs(steer) > dead ? steer : 0,
    };
  }
  return null;
}

// Send loop at 20 Hz
setInterval(() => {
  if (isEstop || currentMode !== "manual") return;

  const gp = getGamepadInput();
  const kp = computeInputFromKeys();

  // Gamepad takes priority if any axis active
  let thr, str;
  if (gp && (Math.abs(gp.throttle) > 0 || Math.abs(gp.steering) > 0)) {
    thr = gp.throttle;
    str = gp.steering;
  } else {
    thr = kp.throttle;
    str = kp.steering;
  }

  throttle = thr;
  steering = str;

  wsSend({ type: "command", cmd: { throttle: thr, steering: str } });
  updateActuatorBars(thr, str);
}, 50);

function updateActuatorBars(thr, str) {
  // Throttle
  const tEl = document.getElementById("bar-throttle");
  const tVal = document.getElementById("val-throttle");
  if (tEl) {
    tEl.style.width = Math.abs(thr) * 100 + "%";
    tEl.style.background = thr >= 0 ? "var(--accent2)" : "var(--warn)";
  }
  if (tVal) tVal.textContent = thr.toFixed(2);

  // Steering (center origin)
  const sEl = document.getElementById("bar-steering");
  const sVal = document.getElementById("val-steering");
  if (sEl) {
    const pct = Math.abs(str) * 50;
    sEl.style.width = pct + "%";
    if (str < 0) {
      sEl.style.left = (50 - pct) + "%";
    } else {
      sEl.style.left = "50%";
    }
    sEl.style.background = "var(--accent)";
  }
  if (sVal) sVal.textContent = str.toFixed(2);
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById("btn-manual").classList.toggle("active", mode === "manual");
  document.getElementById("btn-auto").classList.toggle("active", mode === "auto");

  if (mode === "auto") {
    wsSend({ type: "autonomous", enabled: true });
    addLog("Switched to AUTONOMOUS mode");
  } else {
    wsSend({ type: "autonomous", enabled: false });
    wsSend({ type: "command", cmd: { throttle: 0, steering: 0 } });
    addLog("Switched to MANUAL mode");
  }
}

function sendEstop() {
  isEstop = true;
  wsSend({ type: "estop" });
  wsSend({ type: "command", cmd: { throttle: 0, steering: 0 } });
  document.getElementById("estop-btn").style.display = "none";
  document.getElementById("release-btn").style.display = "block";
  const ov = document.getElementById("estop-overlay");
  if (ov) ov.classList.add("active");
  addLog("!!! EMERGENCY STOP ACTIVATED !!!");
}

function recharge() {
  fetch("/api/battery/recharge", { method: "POST" })
    .then(r => r.json())
    .then(() => addLog("Battery recharged to 100%"));
}

function releaseEstop() {
  isEstop = false;
  wsSend({ type: "command", cmd: { throttle: 0, steering: 0, release_estop: true } });
  document.getElementById("estop-btn").style.display = "block";
  document.getElementById("release-btn").style.display = "none";
  const ov = document.getElementById("estop-overlay");
  if (ov) ov.classList.remove("active");
  addLog("E-Stop released. System ready.");
}
