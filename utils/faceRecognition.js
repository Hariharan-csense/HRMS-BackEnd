const faceapi = require("face-api.js");
const canvas = require("canvas");
const path = require("path");
const fs = require("fs");
const knex = require("../db/db");

faceapi.env.monkeyPatch({
  Canvas: canvas.Canvas,
  Image: canvas.Image,
  ImageData: canvas.ImageData,
});

// Face-api model weights live here. Employee reference photos are loaded later
// from employee_documents.file_path, e.g. /uploads/employees/company_51/photo...
const modelsDir = process.env.FACE_MODEL_DIR
  ? path.resolve(process.env.FACE_MODEL_DIR)
  : path.join(__dirname, "../../models");

let modelsLoaded = false;
let modelLoadError = null;

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
  } catch (error) {
    modelLoadError = error;
    console.error("Error loading face models:", error.message);
    console.error("Make sure all model files are in HRMS/models/ folder");
  }
};

loadModels();

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
  return path.join(__dirname, "../../", normalized);
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

  const rows = await knex("employees as e")
    .innerJoin("employee_documents as d", "e.id", "d.employee_id")
    .where("e.company_id", companyId)
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

  return rows
    .sort((a, b) => {
      const dateA = new Date(a.document_created_at || 0).getTime();
      const dateB = new Date(b.document_created_at || 0).getTime();
      return (
        dateB - dateA || Number(b.document_id || 0) - Number(a.document_id || 0)
      );
    })
    .filter((row, index, sortedRows) => {
      const firstIndex = sortedRows.findIndex(
        (candidate) => Number(candidate.id) === Number(row.id),
      );
      return index === firstIndex;
    });
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
    const storedPhotoPath = resolveUploadPath(employee.photo_path);
    if (!storedPhotoPath || !fs.existsSync(storedPhotoPath)) {
      failures.push({
        employeeId: employee.id,
        reason: `Employee document photo file missing: ${employee.photo_path}`,
      });
      continue;
    }

    try {
      const storedDescriptor = await detectFaceDescriptor(
        storedPhotoPath,
        `employee ${employee.employee_id || employee.id} photo`,
      );
      const distance = faceapi.euclideanDistance(
        storedDescriptor,
        capturedDescriptor,
      );

      matches.push(buildMatchResult({ employee, distance, threshold }));
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
  findEmployeeByFace,
  verifyEmployeeFace,
  loadModels,
};
