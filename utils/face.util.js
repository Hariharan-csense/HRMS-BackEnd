const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function verifyFace(employeeId, imageData) {
  // For now always return true
  // Later integrate real face recognition
  return true;
}

async function saveImage(imageData, employeeId = null, type = 'checkin') {
  try {
    // If imageData is a file path, copy it to uploads directory
    if (imageData && typeof imageData === 'string') {
      const uploadsDir = path.join(__dirname, '../uploads/attendance');
      
      // Create uploads directory if it doesn't exist
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Generate filename with employee ID if available
      let filename;
      if (employeeId) {
        filename = `emp${employeeId}-attendance-${Date.now()}.jpg`;
      } else {
        // Fallback to original format if no employee ID
        filename = `${type}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.jpg`;
      }
      const destinationPath = path.join(uploadsDir, filename);
      
      // Copy file if it exists
      if (fs.existsSync(imageData)) {
        fs.copyFileSync(imageData, destinationPath);
        return `/uploads/attendance/${filename}`;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error saving image:', error);
    return null;
  }
}

module.exports = {
  verifyFace,
  saveImage
};
