const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function isCoordinatePair(body) {
  return (
    Number.isFinite(body?.lat) &&
    body.lat >= -90 &&
    body.lat <= 90 &&
    Number.isFinite(body?.lng) &&
    body.lng >= -180 &&
    body.lng <= 180
  );
}

function locationPoint({ lat, lng, accuracy, timestamp }) {
  return { lat, lng, accuracy: accuracy ?? null, timestamp };
}

function createApp() {
  const app = express();
  const emergencies = new Map();
  const streamClients = new Set();
  let heartbeat = null;

  function sendEvent(response, event, data) {
    if (!response.destroyed && !response.writableEnded) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  function publish(event, emergency) {
    for (const client of streamClients) sendEvent(client, event, emergency);
  }

  function stopHeartbeatIfIdle() {
    if (streamClients.size === 0 && heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  app.use(express.json({ limit: "16kb" }));
  app.use("/dashboard", express.static(path.join(__dirname, "..", "public")));

  app.post("/api/sos", (request, response) => {
    const { id, name, lat, lng, timestamp, accuracy } = request.body ?? {};
    if (
      (id !== undefined && (typeof id !== "string" || id.length > 80)) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 80 ||
      !isCoordinatePair({ lat, lng }) ||
      typeof timestamp !== "string" ||
      Number.isNaN(Date.parse(timestamp)) ||
      (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))
    ) {
      return response.status(400).json({ error: "Datos de emergencia inválidos." });
    }

    const emergencyId = id || randomUUID();
    if (emergencies.has(emergencyId)) {
      return response.status(409).json({ error: "El ID de emergencia ya existe." });
    }

    const emergency = {
      id: emergencyId,
      name: name.trim(),
      lat,
      lng,
      accuracy: accuracy ?? null,
      timestamp,
      lastLocationAt: timestamp,
      status: "active",
      startedAt: new Date().toISOString(),
      cancelledAt: null,
      track: [locationPoint({ lat, lng, accuracy, timestamp })],
      acknowledgedBy: null,
      acknowledgedAt: null,
    };
    emergencies.set(emergencyId, emergency);
    publish("sos-created", emergency);
    return response.status(201).json(emergency);
  });

  app.post("/api/sos/:id/location", (request, response) => {
    const emergency = emergencies.get(request.params.id);
    const { lat, lng, timestamp, accuracy } = request.body ?? {};
    if (!emergency || emergency.status !== "active") {
      return response.status(404).json({ error: "No existe una emergencia activa con ese ID." });
    }
    if (
      !isCoordinatePair({ lat, lng }) ||
      typeof timestamp !== "string" ||
      Number.isNaN(Date.parse(timestamp)) ||
      (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))
    ) {
      return response.status(400).json({ error: "Datos de ubicación inválidos." });
    }

    emergency.lat = lat;
    emergency.lng = lng;
    emergency.accuracy = accuracy ?? null;
    emergency.lastLocationAt = timestamp;
    emergency.track.push(locationPoint({ lat, lng, accuracy, timestamp }));
    if (emergency.track.length > 300) emergency.track.shift();
    publish("sos-location", emergency);
    return response.json(emergency);
  });

  app.post("/api/sos/:id/ack", (request, response) => {
    const emergency = emergencies.get(request.params.id);
    if (!emergency || emergency.status !== "active") {
      return response.status(404).json({ error: "No existe una emergencia activa con ese ID." });
    }

    const { contactName } = request.body ?? {};
    if (
      typeof contactName !== "string" ||
      !contactName.trim() ||
      contactName.trim().length > 80
    ) {
      return response.status(400).json({ error: "El nombre del contacto es inválido." });
    }

    emergency.acknowledgedBy = contactName.trim();
    emergency.acknowledgedAt = new Date().toISOString();
    publish("sos-ack", emergency);
    return response.json(emergency);
  });

  app.post("/api/sos/:id/cancel", (request, response) => {
    const emergency = emergencies.get(request.params.id);
    if (!emergency || emergency.status !== "active") {
      return response.status(404).json({ error: "No existe una emergencia activa con ese ID." });
    }

    emergency.status = "finalized";
    emergency.cancelledAt = new Date().toISOString();
    emergency.finishedAt = emergency.cancelledAt;
    publish("sos-finalized", emergency);
    return response.json(emergency);
  });

  app.get("/api/sos/stream", (_request, response) => {
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.flushHeaders();
    streamClients.add(response);

    const active = [...emergencies.values()].filter(
      (emergency) => emergency.status === "active",
    );
    const finalized = [...emergencies.values()].filter(
      (emergency) => emergency.status === "finalized",
    );
    sendEvent(response, "snapshot", { emergencies: active, finalized });

    if (heartbeat === null) {
      heartbeat = setInterval(() => {
        for (const client of streamClients) {
          if (!client.destroyed && !client.writableEnded) client.write(": ping\n\n");
        }
      }, 15_000);
    }

    response.on("close", () => {
      streamClients.delete(response);
      stopHeartbeatIfIdle();
    });
  });

  app.get("/api/sos/active", (_request, response) => {
    const active = [...emergencies.values()].filter(
      (emergency) => emergency.status === "active",
    );
    const finalized = [...emergencies.values()].filter(
      (emergency) => emergency.status === "finalized",
    );
    return response.json({ emergencies: active, finalized });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json({ error: "El cuerpo JSON no es válido." });
    }
    console.error("Error procesando la solicitud:", error);
    return response.status(500).json({ error: "Error interno del servidor." });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  createApp().listen(port, host, () => {
    console.log(`Backend SOS disponible en http://${host}:${port}`);
    console.log(`Dashboard: http://localhost:${port}/dashboard`);
  });
}

module.exports = { createApp };
