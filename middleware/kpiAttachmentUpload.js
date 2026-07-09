const multer = require("multer");
const path = require("path");
const fs = require("fs");

const baseUploadDir = path.join(__dirname, "../../uploads/kpi-attachments");

if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return cb(new Error("User not assigned to any company"), false);
    }

    const companyUploadDir = path.join(baseUploadDir, `company_${companyId}`);
    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
    }

    cb(null, companyUploadDir);
  },
  filename: (req, file, cb) => {
    const parameterId = req.params.parameterId || "parameter";
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `kpi-param-${parameterId}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = /\.(jpeg|jpg|png|pdf|doc|docx|xls|xlsx)$/i;
  const extname = allowedExtensions.test(
    path.extname(file.originalname).toLowerCase(),
  );

  if (extname) {
    return cb(null, true);
  }

  cb(
    new Error(
      "Invalid file type! Only JPG, PNG, PDF, Word, and Excel files are allowed.",
    ),
    false,
  );
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

module.exports = upload.single("attachment");
