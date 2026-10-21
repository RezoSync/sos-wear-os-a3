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

function createApp() {
  const app = express();
  const emergencies = new Map();

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
    };
    emergencies.set(emergencyId, emergency);
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
    return response.json(emergency);
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
