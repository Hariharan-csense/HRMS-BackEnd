const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Base upload directory
const baseUploadDir = path.join(__dirname, '../../uploads/employees');

// Ensure base directory exists
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const companyId = req.user?.company_id;

    if (!companyId) {
      return cb(new Error('User not assigned to any company'), false);
    }

    const companyUploadDir = path.join(baseUploadDir, `company_${companyId}`);

    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
    }

    cb(null, companyUploadDir);
  },

  filename: (req, file, cb) => {
    const employeeId = req.user?.id || 'unknown';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();

    const filename = `profile-emp${employeeId}-${uniqueSuffix}${ext}`;

    // ✅ FULL RELATIVE PATH FOR DB
    const companyId = req.user?.company_id;
    req.uploadedProfilePath = `/uploads/employees/company_${companyId}/${filename}`;

    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error('Only JPG, JPEG, PNG images are allowed for profile photo!'), false);
};

const upload = multer({
  storage,
  limits: { 
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter
});

const profilePhotoUpload = upload.single('profile_photo');

module.exports = profilePhotoUpload;
