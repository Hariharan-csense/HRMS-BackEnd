// src/utils/faceRecognition.js
const faceapi = require('face-api.js');
const canvas = require('canvas');
const path = require('path');
const fs = require('fs');
const knex = require('../db/db')// knex instance

// Monkey-patch for Node.js canvas
faceapi.env.monkeyPatch({ Canvas: canvas.Canvas, Image: canvas.Image, ImageData: canvas.ImageData });

// Models path - HRMS root-ல models folder
const modelsDir = path.join(__dirname, '../../models');

let modelsLoaded = false;

// Load models once at startup
const loadModels = async () => {
  if (modelsLoaded) return;

  try {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsDir);
    console.log('✅ Face recognition models loaded successfully');
    modelsLoaded = true;
  } catch (error) {
    console.error('❌ Error loading face models:', error.message);
    console.error('Make sure all model files are in HRMS/models/ folder');
  }
};

// Call this in server.js after app setup
loadModels();

// Compare two face images
const compareFaces = async (image1Path, image2Path) => {
  if (!modelsLoaded) {
    throw new Error('Face models not loaded yet');
  }

  try {
    const img1 = await canvas.loadImage(image1Path);
    const img2 = await canvas.loadImage(image2Path);

    const detection1 = await faceapi
      .detectSingleFace(img1)
      .withFaceLandmarks()
      .withFaceDescriptor();

    const detection2 = await faceapi
      .detectSingleFace(img2)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection1 || !detection2) {
      throw new Error('No face detected in one or both images');
    }

    const distance = faceapi.euclideanDistance(detection1.descriptor, detection2.descriptor);

    // Confidence: lower distance = higher confidence
    const confidence = Math.round((1 - distance) * 100);

    return {
      confidence,
      distance,
      isMatch: distance < 0.45, // Slightly relaxed threshold for better UX
      threshold: 0.45
    };
  } catch (error) {
    console.error('Face comparison failed:', error.message);
    throw new Error('Face recognition failed: ' + error.message);
  }
};

// Verify uploaded face against employee's stored photo
const verifyEmployeeFace = async (employeeId, uploadedImagePath) => {
  try {
    const employee = await knex('employees')
      .where({ id: employeeId })
      .select('photo_path')
      .first();

    if (!employee || !employee.photo_path) {
      throw new Error('Employee profile photo not found');
    }

    const storedPhotoPath = path.join(__dirname, '../../', employee.photo_path);

    if (!fs.existsSync(storedPhotoPath)) {
      throw new Error('Stored profile photo file missing');
    }

    const result = await compareFaces(storedPhotoPath, uploadedImagePath);

    return result;
  } catch (error) {
    console.error('Employee face verification error:', error.message);
    throw error;
  }
};

module.exports = {
  compareFaces,
  verifyEmployeeFace,
  loadModels // Export so server.js can call it
};