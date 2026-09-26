const fs = require("fs");
const { Blob, FormData, fetch } = globalThis;

const serviceUrl = () =>
  String(
    process.env.PYTHON_FACE_SERVICE_URL || "http://127.0.0.1:8001",
  ).replace(/\/$/, "");

const unavailable = (message, cause) => {
  const error = new Error(message);
  error.code = "SERVICE_UNAVAILABLE";
  error.statusCode = 503;
  error.cause = cause;
  return error;
};

const request = async (endpoint, fields, imagePath) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  if (imagePath) {
    const buffer = await fs.promises.readFile(imagePath);
    form.append("image", new Blob([buffer]), "face-image.jpg");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(process.env.PYTHON_FACE_SERVICE_TIMEOUT_MS) || 10000),
  );
  try {
    const response = await fetch(`${serviceUrl()}${endpoint}`, {
      method: "POST",
      headers: process.env.FACE_SERVICE_TOKEN
        ? { "X-Face-Service-Token": process.env.FACE_SERVICE_TOKEN }
        : undefined,
      body: form,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw unavailable(
        `Face service returned an invalid response (${response.status})`,
      );
    }
    if (!response.ok) {
      const detail = payload.detail || payload;
      const error = new Error(
        detail.message || detail.code || "Face service request failed",
      );
      error.code =
        detail.code ||
        (response.status >= 500
          ? "SERVICE_UNAVAILABLE"
          : "FACE_PROCESSING_FAILED");
      error.statusCode = response.status >= 500 ? 503 : response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.code && error.statusCode) throw error;
    if (error.name === "AbortError") {
      throw unavailable("Face service request timed out", error);
    }
    throw unavailable("Face service is unavailable", error);
  } finally {
    clearTimeout(timeout);
  }
};

const enroll = (imagePath, { employeeId, companyId, sourcePhoto }) =>
  request(
    "/api/v1/face/enroll",
    {
      employee_id: employeeId,
      company_id: companyId,
      source_photo: sourcePhoto,
    },
    imagePath,
  );

const recognize = (
  imagePath,
  { companyId, templates, threshold, ambiguityMargin },
) =>
  request(
    "/api/v1/face/recognize",
    {
      company_id: companyId,
      templates: JSON.stringify(templates || []),
      threshold,
      ambiguity_margin: ambiguityMargin,
    },
    imagePath,
  );

const verify = (
  imagePath,
  { companyId, employeeId, templates, threshold },
) =>
  request(
    "/api/v1/face/verify",
    {
      company_id: companyId,
      employee_id: employeeId,
      templates: JSON.stringify(templates || []),
      threshold,
    },
    imagePath,
  );

const health = async () => {
  try {
    const response = await fetch(`${serviceUrl()}/health`, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.model_loaded) {
      throw unavailable(`Python face service is not ready (${response.status})`);
    }
    return payload;
  } catch (error) {
    if (error.code === "SERVICE_UNAVAILABLE") throw error;
    throw unavailable("Python face service is unavailable", error);
  }
};

module.exports = { enroll, recognize, verify, health };
