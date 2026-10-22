import { useCallback, useRef } from "react";
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
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map', { zoomControl: true }).setView([19.4326, -99.1332], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    let markers = [];
    let paths = [];
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }
    window.updateEmergencies = function(payload) {
      markers.forEach((item) => map.removeLayer(item));
      paths.forEach((item) => map.removeLayer(item));
      markers = [];
      paths = [];
      const active = payload.emergencies || [];
      active.forEach((emergency) => {
        const marker = L.circleMarker([emergency.lat, emergency.lng], {
          radius: 9, color: '#ff3347', weight: 3, fillColor: '#ff3347', fillOpacity: 0.9
        }).addTo(map).bindPopup('<strong>' + escapeHtml(emergency.name) + '</strong><br>SOS activo');
        markers.push(marker);
        const points = (emergency.track || []).map((point) => [point.lat, point.lng]);
        if (points.length > 1) {
          paths.push(L.polyline(points, { color: '#ff5263', weight: 4, opacity: 0.8 }).addTo(map));
        }
      });
      const selected = active.find((item) => item.id === payload.selectedId);
      const recent = active.reduce((latest, item) =>
        !latest || Date.parse(item.startedAt) > Date.parse(latest.startedAt) ? item : latest, null);
      const target = selected || recent;
      if (target) map.setView([target.lat, target.lng], Math.max(map.getZoom(), 15));
      else if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
      setTimeout(() => map.invalidateSize(), 100);
    };
    window.ReactNativeWebView.postMessage('ready');
  </script>
</body>
</html>`;

type Props = {
  emergencies: Emergency[];
  selectedId: string | null;
};

export function EmergencyMap({ emergencies, selectedId }: Props) {
  const webView = useRef<WebView<{}>>(null);
  const ready = useRef(false);

  const sendEmergencies = useCallback(() => {
    if (!ready.current) return;
    const payload = JSON.stringify({ emergencies, selectedId });
    webView.current?.injectJavaScript(
      `window.updateEmergencies(${payload}); true;`,
    );
  }, [emergencies, selectedId]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (event.nativeEvent.data === "ready") {
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
        onLoadEnd={sendEmergencies}
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
