const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const service = require("./pythonFaceService");

const withServer = async (handler, callback) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.env.PYTHON_FACE_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  try { await callback(); }
  finally { await new Promise((resolve) => server.close(resolve)); }
};

test("face rejection remains a face rejection", async () => {
  await withServer((_req, res) => {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: { code: "NO_FACE", message: "No face was detected" } }));
  }, async () => {
    await assert.rejects(
      service.recognize(__filename, { companyId: 51, templates: [] }),
      (error) => error.code === "NO_FACE" && error.statusCode === 422,
    );
  });
});

test("invalid service response is unavailable", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("not-json");
  }, async () => {
    await assert.rejects(
      service.recognize(__filename, { companyId: 51, templates: [] }),
      (error) => error.code === "SERVICE_UNAVAILABLE" && error.statusCode === 503,
    );
  });
});

test("connection refusal is unavailable", async () => {
  process.env.PYTHON_FACE_SERVICE_URL = "http://127.0.0.1:1";
  await assert.rejects(
    service.health(),
    (error) => error.code === "SERVICE_UNAVAILABLE" && error.statusCode === 503,
  );
});

