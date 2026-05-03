// map.js - Leaflet map, UGV marker, waypoints

const UGV_START = [-6.5891928803930915, 106.80600417337182];
let map, ugvMarker, ugvIcon, trailLine, routeLine, activeRouteLine;
let trailPoints = [];
let waypoints = [];
let wpMarkers = [];
let lastVehicleState = null;

function getWaypointCount() {
  return waypoints.length;
}

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
    html: `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
      <polygon points="15,2 26,26 15,20 4,26" fill="#46b9d8" stroke="#0b0f14" stroke-width="1.5"/>
    </svg>`,
    iconAnchor: [15, 15],
  });

  ugvMarker = L.marker(UGV_START, { icon: ugvIcon }).addTo(map);
  ugvMarker.bindPopup("<b style='font-family:monospace'>UGV-v1</b>");

  trailLine = L.polyline([], {
    color: "#46b9d8",
    weight: 1.5,
    opacity: 0.55,
    dashArray: "4 5",
  }).addTo(map);

  routeLine = L.polyline([], {
    color: "#d7a84f",
    weight: 2,
    opacity: 0.75,
  }).addTo(map);

  activeRouteLine = L.polyline([], {
    color: "#64d98b",
    weight: 2.5,
    opacity: 0.85,
  }).addTo(map);

  map.on("click", (e) => {
    if (clientRole !== "controller") {
      addLog("Observer mode - waypoint editing disabled");
      return;
    }
    addWaypointToMap(e.latlng.lat, e.latlng.lng, true);
  });

  fetch("/api/status")
    .then((r) => r.json())
    .then((d) => {
      const lat = d.state.lat;
      const lng = d.state.lng;
      map.setView([lat, lng], 18);
      ugvMarker.setLatLng([lat, lng]);
    })
    .catch(() => {});

  syncWaypointsFromServer();
}

function syncWaypointsFromServer() {
  apiFetch("/api/waypoints")
    .then((r) => r.json())
    .then((d) => {
      clearLocalWaypoints();
      (d.waypoints || []).forEach((wp) => addWaypointToMap(wp.lat, wp.lng, false));
      refreshAllMarkers();
      renderWaypointList();
      updateRouteLines();
    })
    .catch(() => {});
}

function makeWpIcon(number, status) {
  const bg = status === "reached" ? "#293646"
    : status === "active" ? "#64d98b"
    : "#d7a84f";
  const color = status === "reached" ? "#6f7d8c" : "#0b0f14";
  return L.divIcon({
    className: "",
    html: `<div class="wp-marker ${status}" style="background:${bg};color:${color};">${number}</div>`,
    iconAnchor: [10, 10],
  });
}

function clearLocalWaypoints() {
  wpMarkers.forEach((m) => map.removeLayer(m));
  waypoints = [];
  wpMarkers = [];
  updateRouteLines();
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
  const wp = { lat, lng };
  waypoints.push(wp);

  const marker = L.marker([lat, lng], {
    icon: makeWpIcon(idx + 1, "pending"),
    draggable: true,
  }).addTo(map);

  marker.bindPopup(`<span style='font-family:monospace'>WP ${idx + 1}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}</span>`);
  marker.on("dragend", () => {
    if (clientRole !== "controller") {
      marker.setLatLng([wp.lat, wp.lng]);
      addLog("Observer mode - waypoint editing disabled");
      return;
    }
    const pos = marker.getLatLng();
    const currentIndex = wpMarkers.indexOf(marker);
    if (currentIndex < 0) return;
    waypoints[currentIndex] = { lat: pos.lat, lng: pos.lng };
    updateWaypointOnServer(currentIndex, pos.lat, pos.lng);
    refreshAllMarkers();
    renderWaypointList();
    updateRouteLines();
  });
  wpMarkers.push(marker);

  if (sendToServer) {
    wsSend({ type: "waypoint_add", lat, lng });
    addLog(`Waypoint ${idx + 1} added: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }

  refreshAllMarkers();
  renderWaypointList();
  updateRouteLines();
}

function updateWaypointOnServer(index, lat, lng) {
  apiFetch(`/api/waypoints/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) addLog("Waypoint update failed: " + (d.error || "?"));
      else addLog(`Waypoint ${index + 1} updated`);
    })
    .catch(() => addLog("Waypoint update failed"));
}

function deleteWaypoint(index) {
  if (clientRole !== "controller") {
    addLog("Observer mode - waypoint editing disabled");
    return;
  }
  if (index < 0 || index >= waypoints.length) return;

  map.removeLayer(wpMarkers[index]);
  waypoints.splice(index, 1);
  wpMarkers.splice(index, 1);

  apiFetch(`/api/waypoints/${index}`, { method: "DELETE" })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) addLog("Delete WP failed: " + (d.error || "?"));
    })
    .catch(() => addLog("Delete WP failed"));

  addLog(`Waypoint ${index + 1} deleted - remaining: ${waypoints.length}`);

  if (waypoints.length === 0) {
    setMode("manual");
    addLog("No waypoints remaining - switched to MANUAL");
  }

  refreshAllMarkers();
  renderWaypointList();
  updateRouteLines();
}

function clearWaypoints() {
  if (clientRole !== "controller") {
    addLog("Observer mode - waypoint editing disabled");
    return;
  }
  clearLocalWaypoints();
  apiFetch("/api/waypoints/clear", { method: "POST" });
  addLog("All waypoints cleared");
  renderWaypointList();
  updateMissionStatus(lastVehicleState);
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
  updateRouteLines();
}

function updateRouteLines() {
  if (!routeLine || !activeRouteLine) return;
  routeLine.setLatLngs(waypoints.map((wp) => [wp.lat, wp.lng]));

  if (!lastVehicleState || waypoints.length === 0) {
    activeRouteLine.setLatLngs([]);
    return;
  }

  const idx = Math.min(lastVehicleState.waypoint_index || 0, waypoints.length - 1);
  const remaining = waypoints.slice(idx).map((wp) => [wp.lat, wp.lng]);
  activeRouteLine.setLatLngs([[lastVehicleState.lat, lastVehicleState.lng], ...remaining]);
}

function updateMissionStatus(state) {
  lastVehicleState = state || lastVehicleState;
  const progress = document.getElementById("mission-progress");
  const distance = document.getElementById("mission-distance");
  const eta = document.getElementById("mission-eta");
  if (!progress || !distance || !eta) return;

  const total = waypoints.length;
  const idx = Math.min(lastVehicleState?.waypoint_index ?? 0, total);
  progress.textContent = `WP ${Math.min(idx + (total ? 1 : 0), total)}/${total}`;

  if (!lastVehicleState || total === 0 || idx >= total) {
    distance.textContent = "NEXT -- m";
    eta.textContent = "ETA --";
    return;
  }

  const wp = waypoints[idx];
  const dist = haversineMeters(lastVehicleState.lat, lastVehicleState.lng, wp.lat, wp.lng);
  distance.textContent = `NEXT ${dist < 1000 ? dist.toFixed(0) + " m" : (dist / 1000).toFixed(2) + " km"}`;

  const speed = Math.max(Math.abs(lastVehicleState.speed || 0), 0.1);
  eta.textContent = lastVehicleState.autonomous ? `ETA ${formatEta(dist / speed)}` : "ETA HOLD";
  updateRouteLines();
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
      <span class="wp-coords">${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</span>
      <button class="wp-del-btn" onclick="deleteWaypoint(${i})" title="Delete waypoint ${i + 1}">×</button>
    </div>`;
  }).join("");
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.ceil(seconds / 60);
  return `${mins}m`;
}

setInterval(() => {
  refreshAllMarkers();
  renderWaypointList();
}, 1000);

window.addEventListener("load", initMap);
