// src/controllers/companyController.js
const path = require('path');
const fs = require('fs');
const knex = require('../db/db');
const { generateAutoNumber } = require('../utils/generateAutoNumber');

const uploadRoot = path.resolve(__dirname, '..', '..', '..', 'uploads', 'company-logos');

const toPublicAssetPath = (filename) => (filename ? `/uploads/company-logos/${filename}` : null);

const getUploadedAsset = (req, fieldName) => {
  if (req.files?.[fieldName]?.[0]) return req.files[fieldName][0];
  if (fieldName === 'logo' && req.file) return req.file;
  return null;
};

const cleanupUploadedAssets = (req) => {
  const files = [
    ...(Object.values(req.files || {}).flat()),
    ...(req.file ? [req.file] : [])
  ];

  files.forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
};

const toAbsoluteAssetPath = (assetPath) => {
  if (!assetPath) return null;
  return path.resolve(__dirname, '..', '..', '..', String(assetPath).replace(/^\/+/, ''));
};

const removeAssetFileIfExists = (assetPath) => {
  const absolutePath = toAbsoluteAssetPath(assetPath);
  if (absolutePath && fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const moveUploadedAssetToCanonicalPath = (file, companyId, assetType) => {
  if (!file || !companyId) return null;

  const ext = path.extname(file.originalname || file.filename || '').toLowerCase() || path.extname(file.filename || '').toLowerCase();
  const finalFilename = `company_${companyId}-${assetType}${ext}`;
  const finalAbsolutePath = path.join(uploadRoot, finalFilename);

  if (!fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }

  if (file.path !== finalAbsolutePath) {
    fs.renameSync(file.path, finalAbsolutePath);
  }

  return toPublicAssetPath(finalFilename);
};

const sanitizeCompany = (company) => {
  if (!company) return company;
  const { essl_api_key, ...safeCompany } = company;
  return {
    ...safeCompany,
    essl_api_key_configured: Boolean(essl_api_key),
    logo_url: company.logo || null,
    signature_url: company.signature || null,
  };
};

const clampPayrollDay = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(31, Math.max(1, Math.trunc(parsed)));
};

const withOptionalColumn = async (tableName, payload, columnName, value) => {
  if (await knex.schema.hasColumn(tableName, columnName)) {
    payload[columnName] = value;
  }
  return payload;
};

const createCompany = async (req, res) => {
  const companyId = req.user.company_id;

  // Prevent creating multiple companies if already has one
  if (companyId) {
    cleanupUploadedAssets(req);
    return res.status(403).json({
      success: false,
      message: 'You are already assigned to a company. Only one company per admin allowed.'
    });
  }

  const {
    company_name,
    legal_name,
    gstin_pan,
    industry,
    timezone = 'Asia/Kolkata',
    payroll_cycle = 'Monthly',
    payroll_start_day = 1,
    payroll_end_day = 31,
    address,
    essl_api_key,
    essl_enabled
  } = req.body;

  let logoPath = null;
  let signaturePath = null;

  if (!company_name?.trim() || !legal_name?.trim() || !gstin_pan?.trim()) {
    cleanupUploadedAssets(req);
    return res.status(400).json({
      message: 'Company Name, Legal Name and GSTIN/PAN are required'
    });
  }

  try {
    const company_id = await generateAutoNumber('company');

    let insertPayload = {
      company_id,
      company_name: company_name.trim(),
      legal_name: legal_name.trim(),
      gstin_pan: gstin_pan.trim().toUpperCase(),
      industry: industry?.trim() || null,
      timezone,
      payroll_cycle,
      address: address?.trim() || null,
      essl_api_key: essl_api_key?.trim() || null,
      essl_enabled: String(essl_enabled).toLowerCase() === 'true' || essl_enabled === true,
      logo: logoPath,
      signature: signaturePath,
      created_by: req.user.id
    };
    insertPayload = await withOptionalColumn('companies', insertPayload, 'payroll_start_day', clampPayrollDay(payroll_start_day, 1));
    insertPayload = await withOptionalColumn('companies', insertPayload, 'payroll_end_day', clampPayrollDay(payroll_end_day, 31));

    const [newCompanyId] = await knex('companies').insert(insertPayload);

    // Assign company_id to the admin user
    await knex('users').where({ id: req.user.id }).update({
      company_id: newCompanyId
    });

    const logoFile = getUploadedAsset(req, 'logo');
    const signatureFile = getUploadedAsset(req, 'signature');
    const imageUpdatePayload = { updated_at: knex.fn.now() };

    if (logoFile) {
      logoPath = moveUploadedAssetToCanonicalPath(logoFile, newCompanyId, 'logo');
      imageUpdatePayload.logo = logoPath;
    }

    if (signatureFile) {
      signaturePath = moveUploadedAssetToCanonicalPath(signatureFile, newCompanyId, 'signature');
      imageUpdatePayload.signature = signaturePath;
    }

    if (logoFile || signatureFile) {
      await knex('companies').where({ id: newCompanyId }).update(imageUpdatePayload);
    }

    const newCompany = await knex('companies').where({ id: newCompanyId }).first();

    res.status(201).json({
      success: true,
      message: 'Company created successfully! You are now assigned to this company.',
      company: sanitizeCompany(newCompany)
    });

  } catch (error) {
    cleanupUploadedAssets(req);
    console.error('Create company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET COMPANY (User's own company only)
const getCompany = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(404).json({
      success: false,
      message: 'No company assigned. Please create your company first.'
    });
  }

  try {
    const company = await knex('companies').where({ id: companyId }).first();

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({
      success: true,
      company: sanitizeCompany(company)
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const updateCompany = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    cleanupUploadedAssets(req);
    return res.status(400).json({ message: 'No company assigned to update' });
  }

  const {
    name,
    legalName,
    gstin,
    industry,
    timezone,
    payrollCycle,
    payrollStartDay,
    payrollEndDay,
    address,
    esslApiKey,
    esslEnabled,
    removeLogo,
    removeSignature
  } = req.body;

  let logoPath = null;
  let signaturePath = null;

  try {
    const company = await knex('companies').where({ id: companyId }).first();
    if (!company) {
      cleanupUploadedAssets(req);
      return res.status(404).json({ message: 'Company not found' });
    }

    const logoFile = getUploadedAsset(req, 'logo');
    const signatureFile = getUploadedAsset(req, 'signature');
    const shouldRemoveLogo = String(removeLogo || '').toLowerCase() === 'true';
    const shouldRemoveSignature = String(removeSignature || '').toLowerCase() === 'true';

    if (logoFile) {
      logoPath = moveUploadedAssetToCanonicalPath(logoFile, companyId, 'logo');
    }

    if (signatureFile) {
      signaturePath = moveUploadedAssetToCanonicalPath(signatureFile, companyId, 'signature');
    }

    if ((logoFile || shouldRemoveLogo) && company.logo && company.logo !== logoPath) {
      removeAssetFileIfExists(company.logo);
    }

    if ((signatureFile || shouldRemoveSignature) && company.signature && company.signature !== signaturePath) {
      removeAssetFileIfExists(company.signature);
    }

    let updatePayload = {
      company_name: name?.trim() || company.company_name,
      legal_name: legalName?.trim() || company.legal_name,
      gstin_pan: gstin?.trim().toUpperCase() || company.gstin_pan,
      industry: industry?.trim() || company.industry,
      timezone: timezone || company.timezone,
      payroll_cycle: payrollCycle || company.payroll_cycle,
      address: address?.trim() || company.address,
      essl_api_key: esslApiKey !== undefined ? (esslApiKey?.trim() || null) : company.essl_api_key,
      essl_enabled: esslEnabled !== undefined
        ? String(esslEnabled).toLowerCase() === 'true' || esslEnabled === true
        : company.essl_enabled,
      logo: shouldRemoveLogo && !logoFile ? null : (logoPath || company.logo),
      signature: shouldRemoveSignature && !signatureFile ? null : (signaturePath || company.signature),
      updated_at: knex.fn.now()
    };
    updatePayload = await withOptionalColumn('companies', updatePayload, 'payroll_start_day', clampPayrollDay(payrollStartDay, company.payroll_start_day || 1));
    updatePayload = await withOptionalColumn('companies', updatePayload, 'payroll_end_day', clampPayrollDay(payrollEndDay, company.payroll_end_day || 31));

    await knex('companies').where({ id: companyId }).update(updatePayload);

    const updated = await knex('companies').where({ id: companyId }).first();

    res.json({
      success: true,
      message: 'Company updated successfully!',
      company: sanitizeCompany(updated)
    });

  } catch (error) {
    cleanupUploadedAssets(req);
    console.error('Update company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



// DELETE COMPANY (Admin can delete his own company)
const deleteCompany = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'No company assigned to delete' });
  }

  try {
    const company = await knex('companies').where({ id: companyId }).first();
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Delete logo
    if (company.logo) {
      removeAssetFileIfExists(company.logo);
    }

    if (company.signature) {
      removeAssetFileIfExists(company.signature);
    }

    // Optional: Delete all company data (cascade delete via foreign keys)
    await knex('companies').where({ id: companyId }).del();

    // Remove company_id from admin user
    await knex('users').where({ id: req.user.id }).update({
      company_id: null
    });

    res.json({
      success: true,
      message: 'Company deleted successfully! You can now create a new company.'
    });

  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany
};
