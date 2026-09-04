const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let initialized = false;

const getServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  const candidatePaths = [
    configuredPath ? path.resolve(configuredPath) : null,
    path.resolve(__dirname, "..", "procease-hrms-firebase-adminsdk-fbsvc-d7f2b7edd1.json"),
    path.resolve(__dirname, "..", "procease-hrms-firebase-adminsdk-fbsvc-8662aa3750.json"),
    path.resolve(__dirname, "..", "firebase-adminsdk.json"),
    path.resolve(__dirname, "..", "firebase-service-account.json"),
  ].filter(Boolean);

  const serviceAccountPath = candidatePaths.find((candidate) =>
    fs.existsSync(candidate),
  );

  if (!serviceAccountPath) {
    return null;
  }

  return require(serviceAccountPath);
};

const initializeFirebaseAdmin = () => {
  if (initialized || admin.apps.length) {
    initialized = true;
    return true;
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    console.warn(
      "Firebase Admin not configured. Web push notifications will be skipped.",
    );
    return false;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  initialized = true;
  return true;
};

const getMessaging = () => {
  if (!initializeFirebaseAdmin()) return null;
  return admin.messaging();
};

module.exports = {
  initializeFirebaseAdmin,
  getMessaging,
};
