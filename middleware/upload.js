// src/middleware/companyLogoUpload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Single directory for all company logos (since one company = one logo)
const uploadDir = path.join(__dirname, "../../uploads/company-logos");

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

    // Save with a temporary unique filename first. The controller will
    // rename it to the canonical company_<id>-logo.ext once the actual
    // company record is known.
    cb(null, `company-logo-${uniqueSuffix}${ext}`);
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
      "Invalid file type! Only JPG, PNG, WebP, and SVG images are allowed for company logo.",
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

// Export single file upload for field name 'logo'
module.exports = upload.single("logo");
