// src/middleware/attendanceUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Base upload directory
const baseUploadDir = path.join(__dirname, '../../uploads/attendance');

// Ensure base directory exists
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
  console.log('Created base attendance upload directory:', baseUploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.company_id;

    if (!companyId) {
      return cb(new Error('User not assigned to any company'), false);
    }

    // Company-specific folder: uploads/attendance/company_1, company_2, etc.
    const companyUploadDir = path.join(baseUploadDir, `company_${companyId}`);

    // Create company folder if not exists
    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
      console.log(`Created company attendance directory: ${companyUploadDir}`);
    }

    cb(null, companyUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const employeeId = req.user?.id || 'unknown';
    cb(null, `emp${employeeId}-attendance-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error('Invalid file type! Only JPG, JPEG, PNG, and WebP images are allowed for attendance photos.'), false);
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit per image
  },
  fileFilter
});

// Export middleware for specific field (default: 'image')
module.exports = (fieldName = 'image') => upload.single(fieldName);