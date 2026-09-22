const faceapi = require("face-api.js");
const canvas = require("canvas");
const path = require("path");
const fs = require("fs");
const knex = require("../db/db");
const pythonFaceService = require("../services/pythonFaceService");
const { requirePythonFaceSchema, activeTemplatesForEngine } = require("./pythonFaceTemplateSchema");
const { uploadRoot } = require("./uploadPaths");

faceapi.env.monkeyPatch({
  Canvas: canvas.Canvas,
  Image: canvas.Image,
  ImageData: canvas.ImageData,
});

// Face-api model weights live here. Employee reference photos are loaded later
// from employee_documents.file_path, e.g. /uploads/employees/company_51/photo...
const modelsDir = process.env.FACE_MODEL_DIR
  ? path.resolve(process.env.FACE_MODEL_DIR)
  : path.join(__dirname, "../../../models");

let modelsLoaded = false;
let modelLoadError = null;
const descriptorCache = new Map();
let hasFaceTemplatesTableCache = null;
const companyDescriptorSync = new Map();
const FACE_DESCRIPTOR_SYNC_TTL_MS = Math.max(
  60_000,
  Number(process.env.FACE_DESCRIPTOR_SYNC_TTL_MS) || 10 * 60_000,
);

const loadModels = async () => {
  if (modelsLoaded) return;

  try {
    if (!fs.existsSync(modelsDir)) {
      throw new Error(`Face model directory not found: ${modelsDir}`);
    }

    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsDir);
    console.log("Face recognition models loaded successfully");
    modelsLoaded = true;
    modelLoadError = null;

    if (process.env.FACE_RECOGNITION_ENGINE === "legacy" && process.env.FACE_DESCRIPTOR_PREWARM !== "0") {
      setTimeout(() => {
        warmAllEmployeeDescriptors().catch((error) => {
          console.warn("Face descriptor warm-up failed:", error.message);
        });
      }, 1000);
    }
  } catch (error) {
    modelLoadError = error;
    console.error("Error loading face models:", error.message);
    console.error("Make sure all model files are in HRMS/models/ folder");
  }
};

if (
  process.env.FACE_RECOGNITION_ENGINE === "legacy" &&
  process.env.FACE_LOAD_MODELS_ON_STARTUP === "1"
) {
  loadModels();
}

const calculateEuclideanDistance = (descriptorA, descriptorB) => {
  if (
    !descriptorA ||
    !descriptorB ||
    descriptorA.length !== descriptorB.length
  ) {
    return Number.POSITIVE_INFINITY;
  }

  let sum = 0;
  for (let index = 0; index < descriptorA.length; index += 1) {
    const diff = Number(descriptorA[index]) - Number(descriptorB[index]);
    sum += diff * diff;
  }

  return Math.sqrt(sum);
};

const assertModelsLoaded = async () => {
  if (!modelsLoaded) {
    await loadModels();
  }

  if (!modelsLoaded) {
    const error = new Error(
      modelLoadError?.message || "Face models not loaded yet",
    );
    error.code = "FACE_MODELS_NOT_LOADED";
    throw error;
  }
};

const resolveUploadPath = (filePath) => {
  if (!filePath) return null;

  const rawPath = String(filePath);
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(rawPath);
  const isUncPath = rawPath.startsWith("\\\\");
  if (isWindowsAbsolute || isUncPath) return rawPath;

  const normalized = rawPath.replace(/^[/\\]+/, "");
  if (/^uploads[/\\]/i.test(normalized)) {
    return path.join(uploadRoot, normalized.replace(/^uploads[/\\]+/i, ""));
  }
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
  return path.join(__dirname, "../../../", normalized);
};

const getFaceDetectionOptions = () =>
  new faceapi.SsdMobilenetv1Options({
    minConfidence: 0.2,
    maxResults: 1,
  });

const createEnhancedCanvas = (image) => {
  const output = canvas.createCanvas(image.width, image.height);
  const context = output.getContext("2d");

  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, output.width, output.height);
  const data = frame.data;

  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.min(255, data[index] * 1.18 + 8);
    data[index + 1] = Math.min(255, data[index + 1] * 1.18 + 8);
    data[index + 2] = Math.min(255, data[index + 2] * 1.18 + 8);
  }

  context.putImageData(frame, 0, 0);
  return output;
};

const detectFaceDescriptor = async (imagePath, label = "image") => {
  await assertModelsLoaded();

  const image = await canvas.loadImage(imagePath);
  const attempts = [image, createEnhancedCanvas(image)];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const detection = await faceapi
        .detectSingleFace(attempt, getFaceDetectionOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection) return detection.descriptor;
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(`No face detected in ${label}`);
  error.code = "FACE_NOT_DETECTED";
  error.cause = lastError;
  throw error;
};

const getFileCacheKey = (filePath) => {
  const stats = fs.statSync(filePath);
  return `${filePath}:${stats.size}:${stats.mtimeMs}`;
};

const hasFaceTemplatesTable = async () => {
  if (hasFaceTemplatesTableCache === null) {
    hasFaceTemplatesTableCache = await knex.schema.hasTable("face_templates");
  }

  return hasFaceTemplatesTableCache;
};

const parseStoredDescriptor = (templateHash, expectedCacheKey) => {
  try {
    const payload = JSON.parse(templateHash);
    if (
      payload?.version !== 1 ||
      (expectedCacheKey && payload?.file_key !== expectedCacheKey) ||
      !Array.isArray(payload?.descriptor)
    ) {
      return null;
    }

    return Float32Array.from(payload.descriptor.map(Number));
  } catch {
    return null;
  }
};

const getPersistedEmployeeDescriptor = async (employeeId, cacheKey) => {
  if (!(await hasFaceTemplatesTable())) return null;

  const row = await knex("face_templates")
    .where({ employee_id: employeeId, is_active: true })
    .orderBy("updated_at", "desc")
    .first();

  if (!row?.template_hash) return null;
  return parseStoredDescriptor(row.template_hash, cacheKey);
};

const getCompanyPersistedDescriptors = async (companyId) => {
  if (!(await hasFaceTemplatesTable())) return [];

  const rows = await knex("face_templates as ft")
    .innerJoin("employees as e", "ft.employee_id", "e.id")
    .where("e.company_id", companyId)
    .where("ft.is_active", true)
    .select(
      "ft.template_hash",
      "e.id",
      "e.employee_id",
      "e.first_name",
      "e.last_name",
      "e.email",
      "e.department_id",
      "e.designation_id",
      "e.status",
    );

  return rows
    .map((row) => {
      const descriptor = parseStoredDescriptor(row.template_hash, null);
      if (!descriptor) return null;

      return {
        employee: {
          id: row.id,
          employee_id: row.employee_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          department_id: row.department_id,
          designation_id: row.designation_id,
          status: row.status,
        },
        descriptor,
      };
    })
    .filter(Boolean);
};

const getCompanyPythonTemplates = async (companyId) => {
  await requirePythonFaceSchema(knex);

  const rows = await knex("face_templates as ft")
    .innerJoin("employees as e", "ft.employee_id", "e.id")
    .where("e.company_id", companyId)
    .where("ft.is_active", true)
    .where("ft.model_name", "insightface")
    .whereNotNull("ft.model_version")
    .select("ft.template_hash", "ft.model_version", "e.id as employee_id");

  return rows
    .map((row) => {
      try {
        const payload = JSON.parse(row.template_hash);
        if (!Array.isArray(payload?.embedding)) return null;
        return {
          employee_id: Number(row.employee_id),
          embedding: payload.embedding.map(Number),
          model_version: row.model_version,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const persistPythonEmbedding = async ({
  employeeId,
  companyId,
  sourcePhoto,
  embedding,
  modelVersion,
}) => {
  const columns = await requirePythonFaceSchema(knex);
  const payload = JSON.stringify({ version: 2, embedding });
  await knex.transaction(async (trx) => {
    await activeTemplatesForEngine(trx, employeeId, "python")
      .update({ is_active: false, updated_at: knex.fn.now() });

    const row = {
      employee_id: employeeId,
      template_hash: payload,
      device_used: "python_face_service",
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    };
    if (columns.company_id) row.company_id = companyId;
    if (columns.model_name) row.model_name = "insightface";
    if (columns.model_version) row.model_version = modelVersion;
    if (columns.source_photo) row.source_photo = sourcePhoto || null;
    await trx("face_templates").insert(row);
  });
};

const persistEmployeeDescriptor = async ({
  employeeId,
  cacheKey,
  photoPath,
  descriptor,
}) => {
  if (!(await hasFaceTemplatesTable())) return;

  const columns = await knex("face_templates").columnInfo();

  const templateHash = JSON.stringify({
    version: 1,
    file_key: cacheKey,
    photo_path: photoPath,
    descriptor: Array.from(descriptor),
  });

  await knex.transaction(async (trx) => {
    await activeTemplatesForEngine(trx, employeeId, "legacy", Boolean(columns.model_name))
      .update({ is_active: false, updated_at: knex.fn.now() });

    await trx("face_templates").insert({
      employee_id: employeeId,
      template_hash: templateHash,
      device_used: "employee_document_photo",
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  });
};

const getCachedFaceDescriptor = async (imagePath, label) => {
  const cacheKey = getFileCacheKey(imagePath);
  const cachedDescriptor = descriptorCache.get(cacheKey);

  if (cachedDescriptor) return cachedDescriptor;

  const descriptor = await detectFaceDescriptor(imagePath, label);
  descriptorCache.set(cacheKey, descriptor);

  // Keep memory bounded in long-running servers.
  if (descriptorCache.size > 500) {
    const oldestKey = descriptorCache.keys().next().value;
    descriptorCache.delete(oldestKey);
  }

  return descriptor;
};

const getEmployeeDocumentDescriptor = async (employee, storedPhotoPath) => {
  const cacheKey = getFileCacheKey(storedPhotoPath);
  const cachedDescriptor = descriptorCache.get(cacheKey);
  if (cachedDescriptor) return cachedDescriptor;

  const persistedDescriptor = await getPersistedEmployeeDescriptor(
    employee.id,
    cacheKey,
  );
  if (persistedDescriptor) {
    descriptorCache.set(cacheKey, persistedDescriptor);
    return persistedDescriptor;
  }

  const descriptor = await detectFaceDescriptor(
    storedPhotoPath,
    `employee ${employee.employee_id || employee.id} photo`,
  );

  descriptorCache.set(cacheKey, descriptor);
  await persistEmployeeDescriptor({
    employeeId: employee.id,
    cacheKey,
    photoPath: employee.photo_path,
    descriptor,
  });

  return descriptor;
};

const compareFaces = async (image1Path, image2Path) => {
  await assertModelsLoaded();

  try {
    const descriptor1 = await detectFaceDescriptor(image1Path, "stored photo");
    const descriptor2 = await detectFaceDescriptor(
      image2Path,
      "captured photo",
    );
    const distance = faceapi.euclideanDistance(descriptor1, descriptor2);

    return {
      confidence: Math.max(0, Math.round((1 - distance) * 100)),
      distance,
      isMatch: distance < 0.5,
      threshold: 0.5,
    };
  } catch (error) {
    console.error("Face comparison failed:", error.message);
    const wrapped = new Error(`Face recognition failed: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }
};

const buildMatchResult = ({ employee, distance, threshold }) => ({
  employee,
  confidence: Math.max(0, Math.round((1 - distance) * 100)),
  distance,
  isMatch: distance < threshold,
  threshold,
});

const getEmployeePhotoCandidates = async (companyId) => {
  const columns = await knex("employee_documents").columnInfo();
  const hasType = Object.prototype.hasOwnProperty.call(columns, "type");
  const hasFieldname = Object.prototype.hasOwnProperty.call(
    columns,
    "fieldname",
  );

  const documentRows = await knex("employees as e")
    .innerJoin("employee_documents as d", "e.id", "d.employee_id")
    .where("e.company_id", companyId)
    .whereRaw("LOWER(TRIM(COALESCE(e.status, 'active'))) = ?", ["active"])
    .modify((queryBuilder) => {
      if (hasType && hasFieldname) {
        queryBuilder.whereRaw("LOWER(COALESCE(d.type, d.fieldname, '')) = ?", [
          "photo",
        ]);
      } else if (hasType) {
        queryBuilder.whereRaw("LOWER(d.type) = ?", ["photo"]);
      } else if (hasFieldname) {
        queryBuilder.whereRaw("LOWER(d.fieldname) = ?", ["photo"]);
      }
    })
    .whereNotNull("d.file_path")
    .select(
      "e.id",
      "e.employee_id",
      "e.first_name",
      "e.last_name",
      "e.email",
      "e.department_id",
      "e.designation_id",
      "e.status",
      "d.file_path as photo_path",
      "d.id as document_id",
      "d.created_at as document_created_at",
    );

  // Profile photos are also valid enrollment sources. This covers employees
  // whose photo was uploaded from My Profile instead of the Documents tab.
  const profileRows = await knex("employees as e")
    .where("e.company_id", companyId)
    .whereRaw("LOWER(TRIM(COALESCE(e.status, 'active'))) = ?", ["active"])
    .whereNotNull("e.profile_photo")
    .whereRaw("TRIM(e.profile_photo) <> ''")
    .select(
      "e.id",
      "e.employee_id",
      "e.first_name",
      "e.last_name",
      "e.email",
      "e.department_id",
      "e.designation_id",
      "e.status",
      "e.profile_photo as photo_path",
      "e.updated_at as document_created_at",
    )
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        document_id: 0,
        photo_source: "profile_photo",
      })),
    );

  return [...documentRows, ...profileRows].sort((a, b) => {
    const dateA = new Date(a.document_created_at || 0).getTime();
    const dateB = new Date(b.document_created_at || 0).getTime();
    return (
      dateB - dateA || Number(b.document_id || 0) - Number(a.document_id || 0)
    );
  });
};

const getCompanyPhotoDescriptors = async (companyId) => {
  const candidates = await getEmployeePhotoCandidates(companyId);
  const templates = [];
  const matchedEmployeeIds = new Set();

  for (const employee of candidates) {
    const employeeId = Number(employee.id);
    if (matchedEmployeeIds.has(employeeId)) continue;

    const storedPhotoPath = resolveUploadPath(employee.photo_path);
    if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) continue;

    try {
      const descriptor = await getEmployeeDocumentDescriptor(
        employee,
        storedPhotoPath,
      );
      templates.push({ employee, descriptor });
      matchedEmployeeIds.add(employeeId);
    } catch (error) {
      console.warn(
        `Face template build skipped for employee ${employee.employee_id || employee.id}:`,
        error.message,
      );
    }
  }

  return templates;
};

const warmEmployeeFaceDescriptor = async (employeeId, companyId) => {
  const candidates = (await getEmployeePhotoCandidates(companyId)).filter(
    (employee) => Number(employee.id) === Number(employeeId),
  );
  const failures = [];

  if (process.env.FACE_RECOGNITION_ENGINE !== "legacy") {
    for (const employee of candidates) {
      const storedPhotoPath = resolveUploadPath(employee.photo_path);
      if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
        failures.push(`Photo file missing: ${employee.photo_path}`);
        continue;
      }

      try {
        const result = await pythonFaceService.enroll(storedPhotoPath, {
          employeeId,
          companyId,
          sourcePhoto: employee.photo_path,
        });
        await persistPythonEmbedding({
          employeeId,
          companyId,
          sourcePhoto: employee.photo_path,
          embedding: result.embedding,
          modelVersion: result.model_version,
        });
        return {
          ready: true,
          employeeId: Number(employeeId),
          modelVersion: result.model_version,
        };
      } catch (error) {
        failures.push(error.message);
      }
    }

    return {
      ready: false,
      employeeId: Number(employeeId),
      reason: failures[0] || "No employee photo is available",
    };
  }

  for (const employee of candidates) {
    const storedPhotoPath = resolveUploadPath(employee.photo_path);
    if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
      failures.push(`Photo file missing: ${employee.photo_path}`);
      continue;
    }

    try {
      await getEmployeeDocumentDescriptor(employee, storedPhotoPath);
      return { ready: true, employeeId: Number(employeeId) };
    } catch (error) {
      failures.push(error.message);
    }
  }

  return {
    ready: false,
    employeeId: Number(employeeId),
    reason: failures[0] || "No employee photo is available",
  };
};

const findEmployeeByPythonFace = async (
  companyId,
  uploadedImagePath,
  options = {},
) => {
  const templates = await getCompanyPythonTemplates(companyId);
  if (!templates.length) {
    const error = new Error(
      "No active Python face templates were found for this company. Ask your administrator to enroll existing employee photos with face:migrate:prod and verify the database connection. Reinstalling Python will not fix missing enrollment.",
    );
    error.statusCode = 400;
    error.code = "NO_ENROLLED_FACE";
    throw error;
  }

  const result = await pythonFaceService.recognize(uploadedImagePath, {
    companyId,
    templates,
    threshold: options.threshold,
    ambiguityMargin: options.minimumMargin,
  });
  if (!result.matched) {
    const error = new Error(
      result.reason === "AMBIGUOUS_MATCH"
        ? "Face match is ambiguous. Please retake the photo with better lighting"
        : "Face did not match any employee confidently",
    );
    error.statusCode = result.reason === "AMBIGUOUS_MATCH" ? 409 : 400;
    error.code = result.reason;
    error.bestMatch = result;
    throw error;
  }

  const employee = await knex("employees")
    .where({ id: result.employee_id, company_id: companyId })
    .first();
  if (!employee) {
    const error = new Error("Matched employee is not part of this company");
    error.statusCode = 403;
    error.code = "TENANT_ISOLATION_FAILURE";
    throw error;
  }

  return {
    employee,
    confidence: result.confidence,
    similarity: result.similarity,
    distance: result.distance,
    threshold: result.threshold,
    comparedEmployees: templates.length,
    skippedEmployees: 0,
    modelVersion: result.model_version,
    timings: result.timings,
  };
};

const warmFaceDescriptorCache = async (companyId) => {
  const candidates = await getEmployeePhotoCandidates(companyId);
  const warmedEmployeeIds = new Set();
  let warmed = 0;
  let skipped = 0;

  for (const employee of candidates) {
    if (warmedEmployeeIds.has(Number(employee.id))) continue;

    const storedPhotoPath = resolveUploadPath(employee.photo_path);
    if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
      skipped += 1;
      continue;
    }

    try {
      await getEmployeeDocumentDescriptor(employee, storedPhotoPath);
      warmedEmployeeIds.add(Number(employee.id));
      warmed += 1;
    } catch {
      skipped += 1;
    }
  }

  return { warmed, skipped };
};

const synchronizeCompanyDescriptors = async (companyId, force = false) => {
  const key = Number(companyId);
  const now = Date.now();
  const current = companyDescriptorSync.get(key);

  if (
    !force &&
    current?.completedAt &&
    now - current.completedAt < FACE_DESCRIPTOR_SYNC_TTL_MS
  ) {
    return current.result;
  }

  if (current?.promise) return current.promise;

  const promise = warmFaceDescriptorCache(key)
    .then((result) => {
      companyDescriptorSync.set(key, {
        promise: null,
        completedAt: Date.now(),
        result,
      });
      return result;
    })
    .catch((error) => {
      companyDescriptorSync.delete(key);
      throw error;
    });

  companyDescriptorSync.set(key, {
    promise,
    completedAt: current?.completedAt || 0,
    result: current?.result,
  });
  return promise;
};

const warmAllEmployeeDescriptors = async () => {
  const companyRows = await knex("employees")
    .whereNotNull("company_id")
    .distinct("company_id");

  let totalWarmed = 0;
  let totalSkipped = 0;

  for (const row of companyRows) {
    const companyId = Number(row.company_id);
    if (!companyId) continue;

    const result = await synchronizeCompanyDescriptors(companyId, true);
    totalWarmed += result.warmed;
    totalSkipped += result.skipped;
  }

  if (totalWarmed || totalSkipped) {
    console.log(
      `Face descriptor cache warmed: ${totalWarmed} ready, ${totalSkipped} skipped`,
    );
  }
};

const findEmployeeByFace = async (
  companyId,
  uploadedImagePath,
  options = {},
) => {
  if (!companyId) {
    const error = new Error("Company is required for facial recognition");
    error.statusCode = 400;
    throw error;
  }

  if (!uploadedImagePath || !fs.existsSync(uploadedImagePath)) {
    const error = new Error("Captured face image is required");
    error.statusCode = 400;
    throw error;
  }

  if (process.env.FACE_RECOGNITION_ENGINE !== "legacy") {
    return findEmployeeByPythonFace(companyId, uploadedImagePath, options);
  }

  const threshold = Number(options.threshold) || 0.5;
  const minimumMargin = Number(options.minimumMargin) || 0.04;
  const employees = await getEmployeePhotoCandidates(companyId);

  if (!employees.length) {
    const error = new Error(
      "No employee document photos found for facial recognition",
    );
    error.statusCode = 400;
    throw error;
  }

  const matches = [];
  const failures = [];
  const matchedEmployeeIds = new Set();
  let capturedDescriptor;

  try {
    capturedDescriptor = await detectFaceDescriptor(
      uploadedImagePath,
      "captured photo",
    );
  } catch (error) {
    const noFaceError = new Error(
      "No face was detected. Please keep one face inside the guide and try again",
    );
    noFaceError.statusCode = 400;
    noFaceError.code = error.code || "FACE_NOT_DETECTED";
    throw noFaceError;
  }

  for (const employee of employees) {
    if (matchedEmployeeIds.has(Number(employee.id))) {
      continue;
    }

    const storedPhotoPath = resolveUploadPath(employee.photo_path);
    if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
      failures.push({
        employeeId: employee.id,
        reason: `Employee document photo file missing: ${employee.photo_path}`,
      });
      continue;
    }

    try {
      const storedDescriptor = await getEmployeeDocumentDescriptor(
        employee,
        storedPhotoPath,
      );
      const distance = faceapi.euclideanDistance(
        storedDescriptor,
        capturedDescriptor,
      );

      matches.push(buildMatchResult({ employee, distance, threshold }));
      matchedEmployeeIds.add(Number(employee.id));
    } catch (error) {
      failures.push({ employeeId: employee.id, reason: error.message });
    }
  }

  if (!matches.length) {
    const firstFailure = failures[0]?.reason;
    const error = new Error(
      firstFailure
        ? `Employee document photos could not be used for comparison. ${firstFailure}`
        : "Employee document photos could not be used for comparison. Please re-upload a clear front-facing employee photo in the employee Documents tab",
    );
    error.statusCode = 400;
    error.failures = failures;
    throw error;
  }

  matches.sort((a, b) => a.distance - b.distance);
  const best = matches[0];
  const secondBest = matches[1] || null;

  if (best.distance > threshold) {
    const error = new Error("Face did not match any employee confidently");
    error.statusCode = 400;
    error.bestMatch = {
      confidence: best.confidence,
      distance: best.distance,
      threshold,
    };
    throw error;
  }

  if (secondBest && secondBest.distance - best.distance < minimumMargin) {
    const error = new Error(
      "Face match is ambiguous. Please retake the photo with better lighting",
    );
    error.statusCode = 409;
    error.bestMatch = {
      confidence: best.confidence,
      distance: best.distance,
      secondBestDistance: secondBest.distance,
      minimumMargin,
    };
    throw error;
  }

  return {
    employee: best.employee,
    confidence: best.confidence,
    distance: best.distance,
    threshold,
    comparedEmployees: matches.length,
    skippedEmployees: failures.length,
  };
};

const normalizeIncomingDescriptor = (descriptor) => {
  let values = descriptor;

  if (typeof descriptor === "string") {
    try {
      values = JSON.parse(descriptor);
    } catch {
      values = null;
    }
  }

  if (!Array.isArray(values) || values.length !== 128) {
    const error = new Error("Valid 128-value face descriptor is required");
    error.statusCode = 400;
    throw error;
  }

  return Float32Array.from(values.map(Number));
};

const findEmployeeByDescriptor = async (
  companyId,
  descriptor,
  options = {},
) => {
  if (!companyId) {
    const error = new Error("Company is required for facial recognition");
    error.statusCode = 400;
    throw error;
  }

  const capturedDescriptor = normalizeIncomingDescriptor(descriptor);
  const threshold = Number(options.threshold) || 0.5;
  const minimumMargin = Number(options.minimumMargin) || 0.04;

  // Use persisted descriptors immediately on normal scans. Refreshing every
  // employee photo is comparatively expensive, so keep that work in the
  // background and only block the first scan when no templates exist yet.
  let templates = await getCompanyPersistedDescriptors(companyId);
  if (!templates.length) {
    await synchronizeCompanyDescriptors(companyId);
    templates = await getCompanyPersistedDescriptors(companyId);
  } else {
    void synchronizeCompanyDescriptors(companyId).catch((error) => {
      console.warn("Background face descriptor sync failed:", error.message);
    });
  }

  // The scanner must still work while the face_templates migration is being
  // rolled out. Descriptors built from employee photos are cached in memory
  // and become persisted automatically as soon as the table is available.
  if (!templates.length) {
    templates = await getCompanyPhotoDescriptors(companyId);
  }

  if (!templates.length) {
    const error = new Error(
      "No usable employee face photo was found. Upload a clear front-facing photo in Employee Documents or My Profile, then try again.",
    );
    error.statusCode = 400;
    throw error;
  }

  const matches = templates
    .map(({ employee, descriptor: storedDescriptor }) =>
      buildMatchResult({
        employee,
        distance: calculateEuclideanDistance(
          storedDescriptor,
          capturedDescriptor,
        ),
        threshold,
      }),
    )
    .sort((a, b) => a.distance - b.distance);

  const best = matches[0];
  const secondBest = matches[1] || null;

  if (best.distance > threshold) {
    const error = new Error("Face did not match any employee confidently");
    error.statusCode = 400;
    error.bestMatch = {
      confidence: best.confidence,
      distance: best.distance,
      threshold,
    };
    throw error;
  }

  if (secondBest && secondBest.distance - best.distance < minimumMargin) {
    const error = new Error(
      "Face match is ambiguous. Please retake the photo with better lighting",
    );
    error.statusCode = 409;
    error.bestMatch = {
      confidence: best.confidence,
      distance: best.distance,
      secondBestDistance: secondBest.distance,
      minimumMargin,
    };
    throw error;
  }

  return {
    employee: best.employee,
    confidence: best.confidence,
    distance: best.distance,
    threshold,
    comparedEmployees: matches.length,
    skippedEmployees: 0,
  };
};

const verifyEmployeeFace = async (employeeId, uploadedImagePath) => {
  const columns = await knex("employee_documents").columnInfo();
  const hasType = Object.prototype.hasOwnProperty.call(columns, "type");
  const hasFieldname = Object.prototype.hasOwnProperty.call(
    columns,
    "fieldname",
  );

  const employee = await knex("employees as e")
    .leftJoin("employee_documents as d", "e.id", "d.employee_id")
    .where("e.id", employeeId)
    .modify((queryBuilder) => {
      if (hasType && hasFieldname) {
        queryBuilder.whereRaw("LOWER(COALESCE(d.type, d.fieldname, '')) = ?", [
          "photo",
        ]);
      } else if (hasType) {
        queryBuilder.whereRaw("LOWER(d.type) = ?", ["photo"]);
      } else if (hasFieldname) {
        queryBuilder.whereRaw("LOWER(d.fieldname) = ?", ["photo"]);
      }
    })
    .select("d.file_path as photo_path")
    .first();

  if (!employee?.photo_path) {
    throw new Error("Employee document photo not found");
  }

  const storedPhotoPath = resolveUploadPath(employee.photo_path);

  if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
    throw new Error("Stored employee document photo file missing");
  }

  return compareFaces(storedPhotoPath, uploadedImagePath);
};

module.exports = {
  compareFaces,
  findEmployeeByDescriptor,
  findEmployeeByFace,
  verifyEmployeeFace,
  warmFaceDescriptorCache,
  warmEmployeeFaceDescriptor,
  loadModels,
};
