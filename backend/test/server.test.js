const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
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

  const active = await request(app).get("/api/sos/active").expect(200);
  assert.equal(active.body.emergencies.length, 1);
  assert.equal(active.body.emergencies[0].name, emergency.name);
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
