// map.js — Leaflet map, UGV marker, waypoints

const UGV_START = [-6.5891928803930915, 106.80600417337182]; // IPB University area
let map, ugvMarker, ugvIcon, trailLine;
let trailPoints = [];
let waypoints = [];
let wpMarkers = [];

function initMap() {
  map = L.map("map", {
    center: UGV_START,
    zoom: 18,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "",
    maxZoom: 20,
  }).addTo(map);

  ugvIcon = L.divIcon({
    className: "",
    html: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <polygon points="14,2 24,24 14,19 4,24" fill="#00c8ff" stroke="#0d1117" stroke-width="1.5"/>
    </svg>`,
    iconAnchor: [14, 14],
  });

  ugvMarker = L.marker(UGV_START, { icon: ugvIcon }).addTo(map);
  ugvMarker.bindPopup("<b style='font-family:monospace'>UGV-v1</b>");

  // Fetch real starting position from backend and re-center map
  fetch("/api/status")
    .then(r => r.json())
    .then(d => {
      const lat = d.state.lat;
      const lng = d.state.lng;
      map.setView([lat, lng], 18);
      ugvMarker.setLatLng([lat, lng]);
    })
    .catch(() => {});

  trailLine = L.polyline([], {
    color: "#00c8ff",
    weight: 1.5,
    opacity: 0.5,
    dashArray: "4 4",
  }).addTo(map);

  map.on("click", (e) => {
    if (currentMode !== "auto") {
      addLog("Switch to AUTONOMOUS mode to set waypoints");
      return;
    }
    addWaypointToMap(e.latlng.lat, e.latlng.lng, true);
  });

  // Remove Leaflet attribution element after it renders
  setTimeout(() => {
    document.querySelectorAll(".leaflet-control-attribution").forEach(el => el.remove());
  }, 300);
}

function makeWpIcon(number, status) {
  // status: 'pending' | 'active' | 'reached'
  const bg = status === "reached" ? "#2e4460"
           : status === "active"  ? "#00c8ff"
           : "#ffaa00";
  const color = status === "active" ? "#0d1117" : status === "reached" ? "#4a6278" : "#0d1117";
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};color:${color};font-family:monospace;font-size:10px;font-weight:bold;
      width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      border:1.5px solid #0d1117;transition:background 0.2s;">${number}</div>`,
    iconAnchor: [10, 10],
  });
}

function refreshAllMarkers() {
  const currentIdx = lastTelemetry?.state?.waypoint_index ?? 0;
  wpMarkers.forEach((m, i) => {
    const wp = waypoints[i];
    const status = i < currentIdx ? "reached" : i === currentIdx && currentMode === "auto" ? "active" : "pending";
    m.setIcon(makeWpIcon(i + 1, status));
    m.setPopupContent(`<span style='font-family:monospace'>WP ${i + 1}<br>${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}</span>`);
  });
}

function addWaypointToMap(lat, lng, sendToServer = false) {
  const idx = waypoints.length;
  waypoints.push({ lat, lng });

  const m = L.marker([lat, lng], { icon: makeWpIcon(idx + 1, "pending") }).addTo(map);
  m.bindPopup(`<span style='font-family:monospace'>WP ${idx + 1}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}</span>`);
  wpMarkers.push(m);

  if (sendToServer) {
    wsSend({ type: "waypoint_add", lat, lng });
    addLog(`Waypoint ${idx + 1} added: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }

  renderWaypointList();
}

function deleteWaypoint(index) {
  if (index < 0 || index >= waypoints.length) return;

  // Remove that marker from map
  map.removeLayer(wpMarkers[index]);
  waypoints.splice(index, 1);
  wpMarkers.splice(index, 1);

  // Tell backend
  fetch(`/api/waypoints/${index}`, { method: "DELETE" })
    .then(r => r.json())
    .then(d => { if (!d.ok) addLog("Delete WP failed: " + (d.error || "?")); });

  addLog(`Waypoint ${index + 1} deleted — remaining: ${waypoints.length}`);

  // If no waypoints left, switch UI back to manual
  if (waypoints.length === 0) {
    setMode("manual");
    addLog("No waypoints remaining — switched to MANUAL");
  }

  // Re-number all remaining markers on map
  refreshAllMarkers();
  renderWaypointList();
}

function clearWaypoints() {
  wpMarkers.forEach(m => map.removeLayer(m));
  waypoints = [];
  wpMarkers = [];
  fetch("/api/waypoints/clear", { method: "POST" });
  addLog("All waypoints cleared");
  renderWaypointList();
}

function updateMapMarker(lat, lng, heading, gps) {
  if (!map || !ugvMarker) return;

  const latlng = L.latLng(lat, lng);
  ugvMarker.setLatLng(latlng);

  const el = ugvMarker.getElement();
  if (el) {
    const svg = el.querySelector("svg");
    if (svg) svg.style.transform = `rotate(${heading}deg)`;
  }

  trailPoints.push([lat, lng]);
  if (trailPoints.length > 500) trailPoints.shift();
  trailLine.setLatLngs(trailPoints);
}

function renderWaypointList() {
  const el = document.getElementById("wp-list");
  if (!el) return;
  if (waypoints.length === 0) {
    el.innerHTML = '<div class="wp-empty">No waypoints set</div>';
    return;
  }
  const currentIdx = lastTelemetry?.state?.waypoint_index ?? 0;
  el.innerHTML = waypoints.map((wp, i) => {
    let cls = "wp-item";
    if (i < currentIdx) cls += " reached";
    else if (i === currentIdx && currentMode === "auto") cls += " active-wp";
    return `<div class="${cls}">
      <span class="wp-index">${i + 1}</span>
      <span style="flex:1">${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</span>
      <button class="wp-del-btn" onclick="deleteWaypoint(${i})" title="Delete waypoint ${i + 1}">✕</button>
    </div>`;
  }).join("");
}

// Refresh marker colors + list styling every second
setInterval(() => {
  refreshAllMarkers();
  renderWaypointList();
}, 1000);

window.addEventListener("load", initMap);
