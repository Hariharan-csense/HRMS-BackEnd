// utils/documentAI.js
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');

const client = new DocumentProcessorServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

module.exports = client;
