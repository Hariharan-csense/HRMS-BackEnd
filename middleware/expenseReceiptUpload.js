const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Base upload directory
const baseUploadDir = path.join(__dirname, '../../uploads/expenses');

// Ensure base directory exists
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.company_id;

    if (!companyId) {
      return cb(new Error('User not assigned to any company'), false);
    }

    // uploads/expenses/company_1
    const companyUploadDir = path.join(baseUploadDir, `company_${companyId}`);

    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
    }

    cb(null, companyUploadDir);
  },

  filename: (req, file, cb) => {
    const employeeId = req.user?.id || 'unknown';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();

    cb(null, `expense-emp${employeeId}-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|svg|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(
    new Error(
      'Invalid file type! Only JPG, PNG, WebP, SVG images and PDF files are allowed.'
    ),
    false
  );
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

// Export single file upload
module.exports = upload.single('receipt');
