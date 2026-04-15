// src/controllers/companyController.js
const path = require('path');
const fs = require('fs');
const knex = require('../db/db');
const {generateAutoNumber}   = require('../utils/generateAutoNumber');

const uploadRoot = path.resolve(__dirname, '..', '..', 'uploads', 'company-logos');

const toPublicLogoPath = (filename) => (filename ? `/uploads/company-logos/${filename}` : null);

const toAbsoluteLogoPath = (logoPath) => {
  if (!logoPath) return null;
  return path.resolve(__dirname, '..', '..', String(logoPath).replace(/^\/+/, ''));
};

const removeLogoFileIfExists = (logoPath) => {
  const absolutePath = toAbsoluteLogoPath(logoPath);
  if (absolutePath && fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const moveUploadedLogoToCanonicalPath = (file, companyId) => {
  if (!file || !companyId) return null;

  const ext = path.extname(file.originalname || file.filename || '').toLowerCase() || path.extname(file.filename || '').toLowerCase();
  const finalFilename = `company_${companyId}-logo${ext}`;
  const finalAbsolutePath = path.join(uploadRoot, finalFilename);

  if (!fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }

  if (file.path !== finalAbsolutePath) {
    fs.renameSync(file.path, finalAbsolutePath);
  }

  return toPublicLogoPath(finalFilename);
};

const sanitizeCompany = (company) => {
  if (!company) return company;
  const { essl_api_key, ...safeCompany } = company;
  return {
    ...safeCompany,
    essl_api_key_configured: Boolean(essl_api_key),
  };
};

const createCompany = async (req, res) => {
  const companyId = req.user.company_id;

  // Prevent creating multiple companies if already has one
  if (companyId) {
    if (req.file) fs.unlinkSync(req.file.path);
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
    address,
    essl_api_key,
    essl_enabled
  } = req.body;

  let logoPath = null;

  if (!company_name?.trim() || !legal_name?.trim() || !gstin_pan?.trim()) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({
      message: 'Company Name, Legal Name and GSTIN/PAN are required'
    });
  }

  try {
    const company_id = await generateAutoNumber('company');

    const [newCompanyId] = await knex('companies').insert({
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
      created_by: req.user.id
    });

    // Assign company_id to the admin user
    await knex('users').where({ id: req.user.id }).update({
      company_id: newCompanyId
    });

    if (req.file) {
      logoPath = moveUploadedLogoToCanonicalPath(req.file, newCompanyId);
      await knex('companies').where({ id: newCompanyId }).update({
        logo: logoPath,
        updated_at: knex.fn.now()
      });
    }

    const newCompany = await knex('companies').where({ id: newCompanyId }).first();

    res.status(201).json({
      success: true,
      message: 'Company created successfully! You are now assigned to this company.',
      company: {
        ...sanitizeCompany(newCompany),
        logo_url: logoPath ? `${logoPath}` : null
      }
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
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
      company: {
        ...sanitizeCompany(company),
        logo_url: company.logo ? `${company.logo}` : null
      }
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const updateCompany = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: 'No company assigned to update' });
  }

  const {
    name,
    legalName,
    gstin,
    industry,
    timezone,
    payrollCycle,
    address,
    esslApiKey,
    esslEnabled
  } = req.body;

  let logoPath = null;

  try {
    const company = await knex('companies').where({ id: companyId }).first();
    if (!company) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Company not found' });
    }

    if (req.file) {
      logoPath = moveUploadedLogoToCanonicalPath(req.file, companyId);
    }

    if (req.file && company.logo && company.logo !== logoPath) {
      removeLogoFileIfExists(company.logo);
    }

    await knex('companies').where({ id: companyId }).update({
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
      logo: logoPath || company.logo,
      updated_at: knex.fn.now()
    });

    const updated = await knex('companies').where({ id: companyId }).first();

    res.json({
      success: true,
      message: 'Company updated successfully!',
      company: {
        ...sanitizeCompany(updated),
        logo_url: updated.logo || null
      }
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
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
      removeLogoFileIfExists(company.logo);
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
