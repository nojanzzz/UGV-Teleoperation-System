// telemetry.js — Render incoming telemetry data to the UI

function onTelemetry(msg) {
  const { state, sensors } = msg;
  if (!state || !sensors) return;

  // Speed & heading HUD
  setText("hud-speed", Math.abs(state.speed).toFixed(2));
  setText("hud-heading", state.heading.toFixed(1) + "°");
  setText("compass-val", Math.round(state.heading) + "°");
  drawCompass(state.heading);

  // Actuator bars (autonomous mode override display)
  if (state.autonomous) {
    updateActuatorBars(state.throttle, state.steering);
  }

  // E-Stop state — always mirror backend (handles both activate and release)
  const ov = document.getElementById("estop-overlay");
  if (state.estop !== isEstop) {
    isEstop = state.estop;
    if (state.estop) {
      if (ov) ov.classList.add("active");
      document.getElementById("estop-btn").style.display = "none";
      document.getElementById("release-btn").style.display = "block";
    } else {
      if (ov) ov.classList.remove("active");
      document.getElementById("estop-btn").style.display = "block";
      document.getElementById("release-btn").style.display = "none";
    }
  }

  // Autonomous mode sync
  if (state.autonomous && currentMode !== "auto") {
    currentMode = "auto";
    document.getElementById("btn-auto").classList.add("active");
    document.getElementById("btn-manual").classList.remove("active");
  }

  // Battery
  const bat = sensors.battery;
  setText("stat-battery", bat.percent.toFixed(1) + "%");
  setText("stat-voltage", bat.voltage.toFixed(2) + "V");
  setText("stat-current", bat.current.toFixed(2) + "A");

  const batBar = document.getElementById("battery-bar");
  if (batBar) {
    batBar.style.width = bat.percent + "%";
    batBar.className = "battery-bar";
    if (bat.percent < 20) batBar.classList.add("danger");
    else if (bat.percent < 40) batBar.classList.add("warn");
    
    // Log warning only when percentage integer changes to avoid spam
    const floorBat = Math.floor(bat.percent);
    if (bat.percent < 20 && !isEstop && floorBat !== window.lastBatteryLog) {
      addLog("WARNING: Battery low " + bat.percent.toFixed(0) + "%");
      window.lastBatteryLog = floorBat;
    } else if (bat.percent >= 20) {
      window.lastBatteryLog = null;
    }
  }

  // System
  setText("stat-cputemp", sensors.system.cpu_temp.toFixed(1) + "°C");

  // Uptime
  const u = sensors.system.uptime_s;
  const hh = String(Math.floor(u / 3600)).padStart(2, "0");
  const mm = String(Math.floor((u % 3600) / 60)).padStart(2, "0");
  const ss = String(u % 60).padStart(2, "0");
  setText("uptime", `${hh}:${mm}:${ss}`);

  // IMU
  const imu = sensors.imu;
  setText("imu-ax", imu.accel.x.toFixed(3));
  setText("imu-ay", imu.accel.y.toFixed(3));
  setText("imu-az", imu.accel.z.toFixed(3));
  setText("imu-gz", imu.gyro.z.toFixed(2));

  // GPS
  const gps = sensors.gps;
  setText("gps-fix", gps.fix ? "YES" : "NO");
  setText("hud-sat", gps.satellites);

  // Ultrasonic
  const us = sensors.ultrasonic;
  const usEl = document.getElementById("ultra-front");
  if (usEl) {
    usEl.textContent = us.front_cm.toFixed(0) + "cm";
    usEl.style.color = us.front_cm < 60 ? "var(--danger)" : "var(--text)";
  }

  // Update map marker
  if (typeof updateMapMarker === "function") {
    updateMapMarker(state.lat, state.lng, state.heading, gps);
  }
}

// Compass canvas renderer
function drawCompass(heading) {
  const canvas = document.getElementById("compass");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 4;

  ctx.clearRect(0, 0, W, H);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#1e2d3d";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Tick marks
  const dirs = ["N", "E", "S", "W"];
  for (let i = 0; i < 36; i++) {
    const ang = (i * 10 - 90) * Math.PI / 180;
    const isMain = i % 9 === 0;
    const inner = isMain ? r - 10 : r - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.strokeStyle = isMain ? "#00c8ff" : "#1e2d3d";
    ctx.lineWidth = isMain ? 1.5 : 0.8;
    ctx.stroke();

    if (isMain) {
      const label = dirs[i / 9];
      const lx = cx + Math.cos(ang) * (inner - 10);
      const ly = cy + Math.sin(ang) * (inner - 10);
      ctx.fillStyle = label === "N" ? "#00ff9d" : "#607080";
      ctx.font = "bold 9px 'Barlow Condensed', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx, ly);
    }
  }

  // Heading needle
  const headRad = (heading - 90) * Math.PI / 180;
  const nx = cx + Math.cos(headRad) * (r - 16);
  const ny = cy + Math.sin(headRad) * (r - 16);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = "#00c8ff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#00c8ff";
  ctx.fill();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
