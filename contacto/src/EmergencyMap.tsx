import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import type { Emergency } from "./types";

const MAP_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #17191f; }
    .leaflet-container { background: #17191f; font-family: sans-serif; }
    .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: #22252d; color: #f7f7f8; }
    .leaflet-control-attribution { font-size: 9px !important; }
    #map-error {
      display: none;
      height: 100%;
      align-items: center;
      justify-content: center;
      color: #f7f7f8;
      font: 16px sans-serif;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="map-error">No se pudo cargar el mapa</div>
  <script>
    let map;
    let markers = new Map();
    let paths = new Map();
    let hasCenteredOnEmergency = false;
    let previousSelectedId = null;
    let previousFocusRequest = 0;

    function showMapError() {
      document.getElementById('map').style.display = 'none';
      document.getElementById('map-error').style.display = 'flex';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function initializeMap() {
      if (!window.L) {
        showMapError();
        return;
      }

      map = L.map('map', { zoomControl: true }).setView([19.4326, -99.1332], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      window.updateEmergencies = function(payload) {
        const active = payload.emergencies || [];
        const activeIds = new Set(active.map((emergency) => emergency.id));

        markers.forEach((marker, id) => {
          if (!activeIds.has(id)) {
            map.removeLayer(marker);
            markers.delete(id);
          }
        });
        paths.forEach((path, id) => {
          if (!activeIds.has(id)) {
            map.removeLayer(path);
            paths.delete(id);
          }
        });

        active.forEach((emergency) => {
          const location = [emergency.lat, emergency.lng];
          let marker = markers.get(emergency.id);
          if (!marker) {
            marker = L.circleMarker(location, {
              radius: 9, color: '#ff3347', weight: 3, fillColor: '#ff3347', fillOpacity: 0.9
            }).addTo(map);
            markers.set(emergency.id, marker);
          } else {
            marker.setLatLng(location);
          }
          marker.bindPopup('<strong>' + escapeHtml(emergency.name) + '</strong><br>SOS activo');

          const points = (emergency.track || []).map((point) => [point.lat, point.lng]);
          let path = paths.get(emergency.id);
          if (points.length > 1) {
            if (path) {
              path.setLatLngs(points);
            } else {
              path = L.polyline(points, { color: '#ff5263', weight: 4, opacity: 0.8 }).addTo(map);
              paths.set(emergency.id, path);
            }
          } else if (path) {
            map.removeLayer(path);
            paths.delete(emergency.id);
          }
        });

        const selected = active.find((item) => item.id === payload.selectedId);
        const recent = active.reduce((latest, item) =>
          !latest || Date.parse(item.startedAt) > Date.parse(latest.startedAt) ? item : latest, null);
        const focusRequested = payload.focusRequest !== previousFocusRequest;
        const selectionChanged = payload.selectedId !== previousSelectedId;
        const target = selected || recent;
        const shouldCenterOnSelection =
          Boolean(selected) && (focusRequested || selectionChanged);

        if (target && (shouldCenterOnSelection || !hasCenteredOnEmergency)) {
          map.setView([target.lat, target.lng], 17);
          hasCenteredOnEmergency = true;
        }

        previousSelectedId = payload.selectedId;
        previousFocusRequest = payload.focusRequest;
        setTimeout(() => map.invalidateSize(), 100);
      };

      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    }

    const leafletScript = document.createElement('script');
    leafletScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
    leafletScript.onload = initializeMap;
    leafletScript.onerror = showMapError;
    document.head.appendChild(leafletScript);
  </script>
</body>
</html>`;

type Props = {
  emergencies: Emergency[];
  selectedId: string | null;
  focusRequest: number;
};

type EmergencyPayload = Pick<Props, "emergencies" | "selectedId" | "focusRequest">;

export function EmergencyMap({ emergencies, selectedId, focusRequest }: Props) {
  const webView = useRef<WebView<{}>>(null);
  const ready = useRef(false);
  const latestPayload = useRef<EmergencyPayload>({
    emergencies,
    selectedId,
    focusRequest,
  });
  latestPayload.current = { emergencies, selectedId, focusRequest };

  const sendEmergencies = useCallback(() => {
    if (!ready.current) return;
    const payload = JSON.stringify(latestPayload.current);
    webView.current?.injectJavaScript(
      `window.updateEmergencies(${payload}); true;`,
    );
  }, []);

  useEffect(() => {
    sendEmergencies();
  }, [emergencies, selectedId, focusRequest, sendEmergencies]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (event.nativeEvent.data === JSON.stringify({ type: "ready" })) {
        ready.current = true;
        sendEmergencies();
      }
    },
    [sendEmergencies],
  );

  return (
    <View style={styles.container}>
      <WebView<{}> 
        ref={webView}
        source={{ html: MAP_HTML, baseUrl: "https://localhost" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        onMessage={handleMessage}
        onLoadStart={() => {
          ready.current = false;
        }}
        style={styles.map}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 270,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#17191f",
  },
  map: { backgroundColor: "#17191f" },
});
