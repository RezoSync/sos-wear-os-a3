const map = L.map("map", { zoomControl: true }).setView([23.6345, -102.5528], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const markers = new Map();
const markerAnimations = new Map();
const emergenciesList = document.getElementById("emergencies");
const emptyState = document.getElementById("empty-state");
const connection = document.getElementById("connection");
const numberFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 5 });
let focusSignature = null;
let lastFocus = null;

function updateList(emergencies, finalized) {
  emergenciesList.replaceChildren();
  emptyState.hidden = emergencies.length + finalized.length > 0;

  for (const emergency of [...emergencies, ...finalized]) {
    const item = document.createElement("li");
    item.className = `emergency-card${emergency.status === "finalized" ? " finalized" : ""}`;
    const name = document.createElement("strong");
    name.textContent = emergency.name;
    const status = document.createElement("span");
    status.className = "emergency-status";
    status.textContent = emergency.status === "finalized" ? "Finalizada" : "SOS activo";
    const position = document.createElement("span");
    position.textContent = `${numberFormat.format(emergency.lat)}, ${numberFormat.format(emergency.lng)}`;
    const updated = document.createElement("span");
    const locationTime = emergency.lastLocationAt ?? emergency.timestamp;
    updated.textContent = `Última ubicación: ${new Date(locationTime).toLocaleTimeString("es-MX")}`;
    item.append(name, status, position, updated);
    emergenciesList.append(item);
  }
}

async function refreshEmergencies() {
  try {
    const response = await fetch("/api/sos/active", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const { emergencies, finalized = [] } = await response.json();
    connection.textContent = "Backend conectado";
    connection.className = "connection online";
    updateList(emergencies, finalized);

    const visibleEmergencies = [...emergencies, ...finalized];
    const visibleIds = new Set(visibleEmergencies.map((emergency) => emergency.id));
    for (const [id, marker] of markers) {
      if (!visibleIds.has(id)) {
        const animation = markerAnimations.get(id);
        if (animation !== undefined) window.cancelAnimationFrame(animation);
        markerAnimations.delete(id);
        map.removeLayer(marker);
        markers.delete(id);
      }
    }

    for (const emergency of visibleEmergencies) {
      const position = [emergency.lat, emergency.lng];
      const marker = markers.get(emergency.id);
      const finalizedStatus = emergency.status === "finalized";
      const status = finalizedStatus ? "Finalizada" : "SOS activo";
      const popup = `<strong>${escapeHtml(emergency.name)}</strong><br>${escapeHtml(status)}<br>${numberFormat.format(emergency.lat)}, ${numberFormat.format(emergency.lng)}`;
      if (marker) {
        if (finalizedStatus) {
          const animation = markerAnimations.get(emergency.id);
          if (animation !== undefined) window.cancelAnimationFrame(animation);
          markerAnimations.delete(emergency.id);
          marker.setLatLng(position).setOpacity(0.65);
        } else {
          animateMarker(emergency.id, marker, position);
        }
        marker.setPopupContent(popup);
      } else {
        markers.set(
          emergency.id,
          L.marker(position, { opacity: finalizedStatus ? 0.65 : 1 }).addTo(map).bindPopup(popup),
        );
      }
    }

    const nextFocusSignature = emergencies.map((emergency) => emergency.id).sort().join(",");
    if (emergencies.length === 1) {
      const [emergency] = emergencies;
      const position = [emergency.lat, emergency.lng];
      const movedFarEnough = !lastFocus || distanceInMeters(lastFocus, position) >= 35;
      if (
        nextFocusSignature !== focusSignature ||
        movedFarEnough ||
        map.getZoom() < 15
      ) {
        map.flyTo(position, Math.max(map.getZoom(), 15), { duration: 1.2 });
        lastFocus = position;
      }
      focusSignature = nextFocusSignature;
    } else if (emergencies.length > 1) {
      if (nextFocusSignature !== focusSignature) {
        map.fitBounds(
          emergencies.map((emergency) => [emergency.lat, emergency.lng]),
          { padding: [32, 32], maxZoom: 15 },
        );
      }
      focusSignature = nextFocusSignature;
      lastFocus = null;
    } else {
      focusSignature = null;
      lastFocus = null;
    }
  } catch (error) {
    connection.textContent = "Backend no disponible";
    connection.className = "connection offline";
    console.error("No se pudo actualizar el dashboard:", error);
  }
}

function animateMarker(id, marker, target) {
  const previousAnimation = markerAnimations.get(id);
  if (previousAnimation !== undefined) window.cancelAnimationFrame(previousAnimation);

  const start = marker.getLatLng();
  const targetLatitude = target[0];
  const targetLongitude = target[1];
  if (start.lat === targetLatitude && start.lng === targetLongitude) return;

  const startTime = performance.now();
  const duration = 1800;
  function moveFrame(now) {
    const linearProgress = Math.min((now - startTime) / duration, 1);
    const easedProgress = (1 - Math.cos(Math.PI * linearProgress)) / 2;
    marker.setLatLng([
      start.lat + (targetLatitude - start.lat) * easedProgress,
      start.lng + (targetLongitude - start.lng) * easedProgress,
    ]);
    if (linearProgress < 1) {
      markerAnimations.set(id, window.requestAnimationFrame(moveFrame));
    } else {
      markerAnimations.delete(id);
    }
  }
  markerAnimations.set(id, window.requestAnimationFrame(moveFrame));
}

function distanceInMeters(first, second) {
  const radians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDifference = radians(second[0] - first[0]);
  const longitudeDifference = radians(second[1] - first[1]);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(first[0])) *
      Math.cos(radians(second[0])) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

refreshEmergencies();
window.setInterval(refreshEmergencies, 2000);
