// controllers/documentController.js
const knex = require('../db/db');
const path = require('path');

// @desc    Get employee documents
// @route   GET /api/documents
// @access  Private
const getEmployeeDocuments = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;
    console.log('Fetching documents for employee ID:', employeeId);
    console.log('Company ID:', companyId);
    console.log('User object:', req.user);

    const documents = await knex('employee_documents')
      .where({
        employee_id: employeeId,
        company_id: companyId
      })
      .select(
        'id',
        'type',
        'file_path',
        'filename', // Use filename instead of original_name
        'original_name',
        'created_at'
      )
      .orderBy('created_at', 'desc');

    console.log('Documents found:', documents.length);
    console.log('Documents data:', documents);

    res.status(200).json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message
    });
  }
};

// @desc    Download document
// @route   GET /api/documents/:id/download
// @access  Private
const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    // Get document info
    const document = await knex('employee_documents')
      .where({
        id: id,
        employee_id: employeeId,
        company_id: companyId
      })
      .first();

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Use filename if original_name is null
    const downloadName = document.original_name || document.filename || 'document';
    
    // The file_path in database is already an absolute path, so use it directly
    // But normalize it to handle mixed slashes
    const filePath = document.file_path.replace(/\\/g, '/');
    
    console.log('Original file path from DB:', document.file_path);
    console.log('Normalized file path:', filePath);
    console.log('Download name:', downloadName);
    
    // Check if file exists before sending
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }
    
    // Send file for download
    res.download(filePath, downloadName, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).json({
          success: false,
          message: 'Error downloading file'
        });
      }
    });
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message
    });
  }
};

module.exports = {
  getEmployeeDocuments,
  downloadDocument
};
