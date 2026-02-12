// src/middleware/companyLogoUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Single directory for all company logos (since one company = one logo)
const uploadDir = path.join(__dirname, '../../uploads/company-logos');

// Ensure directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created company logos upload directory:', uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const companyId = req.user?.company_id;

    if (!companyId) {
      return cb(new Error('User not assigned to any company'), false);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    
    // Fixed filename per company: company_1-logo.png, company_2-logo.jpg
    // This makes it easy to delete old logo when updating
    cb(null, `company_${companyId}-logo${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|svg/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error('Invalid file type! Only JPG, PNG, WebP, and SVG images are allowed for company logo.'), false);
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter
});

// Export single file upload for field name 'logo'
module.exports = upload.single('logo');