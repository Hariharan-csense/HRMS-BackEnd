// src/middleware/companyLogoUpload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { resolveUploadPath } = require("../utils/uploadPaths");

// Single directory for company brand assets.
const uploadDir = resolveUploadPath("company-logos");

// Ensure directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("Created company logos upload directory:", uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    const assetType = file.fieldname === "signature" ? "signature" : "logo";

    // Save with a temporary unique filename first. The controller will
    // rename it to the canonical company_<id>-<asset>.ext once the actual
    // company record is known.
    cb(null, `company-${assetType}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|svg/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(
    new Error(
      "Invalid file type! Only JPG, PNG, WebP, and SVG images are allowed for company brand assets.",
    ),
    false,
  );
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter,
});

module.exports = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "signature", maxCount: 1 },
]);
