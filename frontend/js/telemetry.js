// telemetry.js - Render incoming telemetry data to the UI

function onTelemetry(msg) {
  const { state, sensors } = msg;
  if (!state || !sensors) return;

  const telemetryAge = msg.ts ? Math.max(0, Date.now() - msg.ts * 1000) : 0;
  const ageText = typeof formatTelemetryAge === "function" ? formatTelemetryAge(telemetryAge) : "-- ms";

  setText("hud-speed", Math.abs(state.speed).toFixed(2));
  setText("hud-heading", state.heading.toFixed(1) + "°");
  setText("compass-val", Math.round(state.heading) + "°");
  setText("cam-speed", Math.abs(state.speed).toFixed(2));
  setText("cam-heading", state.heading.toFixed(1));
  setText("cam-age", ageText);
  drawCompass(state.heading);

  if (state.autonomous) {
    updateInputDisplay(state.throttle, state.steering, "autonomous");
  }

  const ov = document.getElementById("estop-overlay");
  if (state.estop !== isEstop) {
    setEstopUi(state.estop);
    if (ov) ov.classList.toggle("active", state.estop);
  }

  const mode = state.autonomous ? "auto" : "manual";
  if (mode !== currentMode) syncModeButtons(mode);

  const bat = sensors.battery;
  setText("stat-battery", bat.percent.toFixed(1) + "%");
  setText("stat-voltage", bat.voltage.toFixed(2) + "V");
  setText("stat-current", bat.current.toFixed(2) + "A");
  setText("cam-battery", bat.percent.toFixed(0));
  document.body.classList.toggle("battery-low", bat.percent < 20);

  const batBar = document.getElementById("battery-bar");
  if (batBar) {
    batBar.style.width = bat.percent + "%";
    batBar.className = "battery-bar";
    if (bat.percent < 20) batBar.classList.add("danger");
    else if (bat.percent < 40) batBar.classList.add("warn");

    const floorBat = Math.floor(bat.percent);
    if (bat.percent < 20 && !isEstop && floorBat !== window.lastBatteryLog) {
      addLog("Warning: battery low " + bat.percent.toFixed(0) + "%");
      window.lastBatteryLog = floorBat;
    } else if (bat.percent >= 20) {
      window.lastBatteryLog = null;
    }
  }

  setText("stat-cputemp", sensors.system.cpu_temp.toFixed(1) + "°C");

  const u = sensors.system.uptime_s;
  const hh = String(Math.floor(u / 3600)).padStart(2, "0");
  const mm = String(Math.floor((u % 3600) / 60)).padStart(2, "0");
  const ss = String(u % 60).padStart(2, "0");
  setText("uptime", `${hh}:${mm}:${ss}`);

  const imu = sensors.imu;
  setText("imu-ax", imu.accel.x.toFixed(3));
  setText("imu-ay", imu.accel.y.toFixed(3));
  setText("imu-az", imu.accel.z.toFixed(3));
  setText("imu-gz", imu.gyro.z.toFixed(2));

  const gps = sensors.gps;
  setText("gps-fix", gps.fix ? "YES" : "NO");
  setText("hud-sat", gps.satellites);

  const us = sensors.ultrasonic;
  const usEl = document.getElementById("ultra-front");
  if (usEl) {
    usEl.textContent = us.front_cm.toFixed(0) + "cm";
    usEl.style.color = us.front_cm < 60 ? "var(--danger)" : "var(--text)";
  }

  if (typeof updateMapMarker === "function") {
    updateMapMarker(state.lat, state.lng, state.heading, gps);
  }
  if (typeof updateFpvScene === "function") {
    updateFpvScene(state);
  }
  if (typeof updateMissionStatus === "function") {
    updateMissionStatus(state);
  }
}

function drawCompass(heading) {
  const canvas = document.getElementById("compass");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const r = W / 2 - 4;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#253244";
  ctx.lineWidth = 2;
  ctx.stroke();

  const dirs = ["N", "E", "S", "W"];
  for (let i = 0; i < 36; i++) {
    const ang = (i * 10 - 90) * Math.PI / 180;
    const isMain = i % 9 === 0;
    const inner = isMain ? r - 10 : r - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.strokeStyle = isMain ? "#46b9d8" : "#253244";
    ctx.lineWidth = isMain ? 1.5 : 0.8;
    ctx.stroke();

    if (isMain) {
      const label = dirs[i / 9];
      const lx = cx + Math.cos(ang) * (inner - 10);
      const ly = cy + Math.sin(ang) * (inner - 10);
      ctx.fillStyle = label === "N" ? "#64d98b" : "#8190a3";
      ctx.font = "bold 9px 'Barlow Condensed', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx, ly);
    }
  }

  const headRad = (heading - 90) * Math.PI / 180;
  const nx = cx + Math.cos(headRad) * (r - 16);
  const ny = cy + Math.sin(headRad) * (r - 16);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = "#46b9d8";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#46b9d8";
  ctx.fill();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
