const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const request = require("supertest");
const { createApp } = require("../src/server");

const app = createApp();
const emergency = {
  id: "test-emergency-1",
  name: "Persona de prueba",
  lat: 23.6345,
  lng: -102.5528,
  accuracy: 8,
  timestamp: "2026-10-19T12:00:00.000Z",
};

test("una instancia nueva del backend empieza sin emergencias anteriores", async () => {
  const freshApp = createApp();
  const active = await request(freshApp).get("/api/sos/active").expect(200);
  assert.deepEqual(active.body.emergencies, []);
  assert.deepEqual(active.body.finalized, []);
});

before(async () => {
  await request(app).post("/api/sos/test-emergency-1/cancel");
});

after(async () => {
  await request(app).post("/api/sos/test-emergency-1/cancel");
});

test("inicia una emergencia y la muestra como activa", async () => {
  const started = await request(app).post("/api/sos").send(emergency).expect(201);
  assert.equal(started.body.status, "active");
  assert.equal(started.body.id, emergency.id);
  assert.equal(started.body.trigger, "manual");

  const active = await request(app).get("/api/sos/active").expect(200);
  assert.equal(active.body.emergencies.length, 1);
  assert.equal(active.body.emergencies[0].name, emergency.name);
  assert.equal(active.body.emergencies[0].trigger, "manual");
});

test("acepta y conserva triggers válidos, y rechaza valores inválidos", async () => {
  const freshApp = createApp();
  const started = await request(freshApp)
    .post("/api/sos")
    .send({ ...emergency, id: "voice-trigger-test", trigger: "voz" })
    .expect(201);
  assert.equal(started.body.trigger, "voz");

  const active = await request(freshApp).get("/api/sos/active").expect(200);
  assert.equal(active.body.emergencies[0].trigger, "voz");

  await request(freshApp)
    .post("/api/sos")
    .send({ ...emergency, id: "invalid-trigger-test", trigger: "desconocido" })
    .expect(400)
    .expect({ error: "Datos de emergencia inválidos." });
});

test("actualiza la ubicación de una emergencia activa", async () => {
  const changed = await request(app)
    .post(`/api/sos/${emergency.id}/location`)
    .send({ lat: 23.7, lng: -102.5, accuracy: 5, timestamp: "2026-10-19T12:00:05.000Z" })
    .expect(200);
  assert.equal(changed.body.lat, 23.7);
  assert.equal(changed.body.lng, -102.5);
});

test("rechaza coordenadas inválidas", async () => {
  await request(app)
    .post("/api/sos")
    .send({ ...emergency, id: "invalid-emergency", lat: 91 })
    .expect(400);
});

test("finaliza una emergencia y la muestra como Finalizada", async () => {
  const finished = await request(app).post(`/api/sos/${emergency.id}/cancel`).expect(200);
  assert.equal(finished.body.status, "finalized");
  const active = await request(app).get("/api/sos/active").expect(200);
  assert.equal(active.body.emergencies.length, 0);
  assert.equal(active.body.finalized.length, 1);
  assert.equal(active.body.finalized[0].id, emergency.id);
});

test("el rastro incluye la ubicación inicial y conserva como máximo 300 puntos", async () => {
  const freshApp = createApp();
  const id = "track-limit-test";
  const started = await request(freshApp)
    .post("/api/sos")
    .send({ ...emergency, id })
    .expect(201);
  assert.deepEqual(started.body.track, [{
    lat: emergency.lat,
    lng: emergency.lng,
    accuracy: emergency.accuracy,
    timestamp: emergency.timestamp,
  }]);

  for (let point = 1; point <= 300; point++) {
    await request(freshApp)
      .post(`/api/sos/${id}/location`)
      .send({
        lat: emergency.lat + point / 10_000,
        lng: emergency.lng,
        accuracy: 5,
        timestamp: `2026-10-19T12:${String(Math.floor(point / 60)).padStart(2, "0")}:${String(point % 60).padStart(2, "0")}.000Z`,
      })
      .expect(200);
  }

  const active = await request(freshApp).get("/api/sos/active").expect(200);
  const [tracked] = active.body.emergencies;
  assert.equal(tracked.track.length, 300);
  assert.notEqual(tracked.track[0].timestamp, emergency.timestamp);
  assert.equal(tracked.track.at(-1).lat, emergency.lat + 300 / 10_000);
});

test("el acuse actualiza el contacto, es idempotente y valida la emergencia", async () => {
  const freshApp = createApp();
  const id = "ack-test";
  await request(freshApp).post("/api/sos").send({ ...emergency, id }).expect(201);
  await request(freshApp).post(`/api/sos/${id}/ack`).send({}).expect(400);

  const first = await request(freshApp)
    .post(`/api/sos/${id}/ack`)
    .send({ contactName: "  Ana  " })
    .expect(200);
  assert.equal(first.body.acknowledgedBy, "Ana");
  assert.ok(Number.isFinite(Date.parse(first.body.acknowledgedAt)));

  const second = await request(freshApp)
    .post(`/api/sos/${id}/ack`)
    .send({ contactName: "Luis" })
    .expect(200);
  assert.equal(second.body.acknowledgedBy, "Luis");
  assert.equal(second.body.id, id);

  await request(freshApp).post(`/api/sos/${id}/cancel`).expect(200);
  await request(freshApp)
    .post(`/api/sos/${id}/ack`)
    .send({ contactName: "Ana" })
    .expect(404);
});

test("SSE envía snapshot y sos-created, y cierra la conexión de prueba", async () => {
  const freshApp = createApp();
  const server = freshApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  let client;
  let streamResponse;
  let buffer = "";
  const waiters = new Map();
  const waitForEvent = (name) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(name);
      reject(new Error(`Tiempo agotado esperando el evento SSE ${name}`));
    }, 5_000);
    waiters.set(name, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });

  try {
    const snapshotPromise = waitForEvent("snapshot");
    client = http.get(`http://127.0.0.1:${server.address().port}/api/sos/stream`, (response) => {
      streamResponse = response;
      assert.match(response.headers["content-type"], /^text\/event-stream/);
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event && data && waiters.has(event)) waiters.get(event)(JSON.parse(data));
          separator = buffer.indexOf("\n\n");
        }
      });
    });

    const snapshot = await snapshotPromise;
    assert.deepEqual(snapshot, { emergencies: [], finalized: [] });

    const createdPromise = waitForEvent("sos-created");
    const created = await request(freshApp)
      .post("/api/sos")
      .send({ ...emergency, id: "stream-created-test" })
      .expect(201);
    const streamed = await createdPromise;
    assert.equal(streamed.id, created.body.id);
    assert.equal(streamed.track.length, 1);
    assert.equal(streamed.trigger, "manual");
  } finally {
    if (client) client.destroy();
    if (streamResponse) streamResponse.destroy();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
