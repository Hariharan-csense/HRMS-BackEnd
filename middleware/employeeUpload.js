// src/middleware/employeeUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Base upload directory
const baseUploadDir = path.join(__dirname, '../../uploads/employees');

// Ensure base directory exists
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
  console.log('Created base employees upload directory:', baseUploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.company_id;

    if (!companyId) {
      return cb(new Error('User not assigned to any company'), false);
    }

    // Company-specific folder: uploads/employees/company_1, company_2, etc.
    const companyUploadDir = path.join(baseUploadDir, `company_${companyId}`);

    // Create company folder if not exists
    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
      console.log(`Created company employee directory: ${companyUploadDir}`);
    }

    cb(null, companyUploadDir);
  },
  filename: (req, file, cb) => {
    const employeeId = req.body.id || req.user?.id || 'unknown';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Filename format: photo-emp7-1700000000000-123456789.jpg
    cb(null, `${file.fieldname}-emp${employeeId}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error('Only Images (JPG, PNG) and PDF files are allowed for employee documents!'), false);
};

const upload = multer({
  storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB per file
  },
  fileFilter
});

// Multiple fields upload
const employeeUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'id_proof', maxCount: 1 },
  { name: 'address_proof', maxCount: 1 },
  { name: 'offer_letter', maxCount: 1 },
  { name: 'certificates', maxCount: 5 }, // Allow multiple certificates
  { name: 'bank_proof', maxCount: 1 }
]);

module.exports = employeeUpload;