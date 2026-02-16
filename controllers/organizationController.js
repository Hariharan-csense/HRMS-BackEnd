const db = require('../db/db');
const { v4: uuidv4 } = require('uuid');

// Get all organizations (companies)
const getOrganizations = async (req, res) => {
  try {
    const { company_id } = req.user;
    
    console.log('User info:', { 
      userRole: req.user.role, 
      userType: req.user.type,
      company_id: company_id,
      user: req.user 
    });
    
    // For super admin, get all companies with subscription info and user counts
    // For regular users, get only their company
    let organizations;
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      console.log('Fetching all companies for superadmin');
      organizations = await db('companies')
        .leftJoin('company_subscriptions', 'companies.id', 'company_subscriptions.company_id')
        .leftJoin('subscription_plans', 'company_subscriptions.plan_id', 'subscription_plans.id')
        .leftJoin('employees', 'companies.id', 'employees.company_id')
        .leftJoin('users', 'employees.email', 'users.email')
        .select([
          'companies.id',
          'companies.company_name as name',
          'companies.legal_name as owner',
          'companies.created_at',
          'companies.updated_at',
          'subscription_plans.name as plan',
          'company_subscriptions.trial_end_date',
          'company_subscriptions.storage_gb as totalStorage',
          db.raw('DATEDIFF(company_subscriptions.trial_end_date, CURDATE()) as daysLeft'),
          db.raw('COALESCE(company_subscriptions.paid_amount, 0) as revenue'),
          db.raw('COUNT(DISTINCT employees.id) as user_count')
        ])
        .groupBy(
          'companies.id',
          'companies.company_name',
          'companies.legal_name',
          'companies.created_at',
          'companies.updated_at',
          'subscription_plans.name',
          'company_subscriptions.trial_end_date',
          'company_subscriptions.storage_gb',
          'company_subscriptions.paid_amount'
        )
        .orderBy('companies.created_at', 'desc');
    } else {
      console.log('Fetching company for regular user, company_id:', company_id);
      // For regular users, if no company_id assigned, return empty array
      if (!company_id) {
        console.log('No company_id found for user, returning empty array');
        return res.json({
          success: true,
          data: [],
          message: 'User not assigned to any company'
        });
      }
      organizations = await db('companies')
        .leftJoin('company_subscriptions', 'companies.id', 'company_subscriptions.company_id')
        .leftJoin('subscription_plans', 'company_subscriptions.plan_id', 'subscription_plans.id')
        .leftJoin('employees', 'companies.id', 'employees.company_id')
        .leftJoin('users', 'employees.email', 'users.email')
        .where('companies.id', company_id)
        .select([
          'companies.id',
          'companies.company_name as name',
          'companies.legal_name as owner',
          'companies.created_at',
          'companies.updated_at',
          'subscription_plans.name as plan',
          'company_subscriptions.trial_end_date',
          'company_subscriptions.storage_gb as totalStorage',
          db.raw('DATEDIFF(company_subscriptions.trial_end_date, CURDATE()) as daysLeft'),
          db.raw('COALESCE(company_subscriptions.paid_amount, 0) as revenue'),
          db.raw('COUNT(DISTINCT employees.id) as user_count')
        ])
        .groupBy(
          'companies.id',
          'companies.company_name',
          'companies.legal_name',
          'companies.created_at',
          'companies.updated_at',
          'subscription_plans.name',
          'company_subscriptions.trial_end_date',
          'company_subscriptions.storage_gb',
          'company_subscriptions.paid_amount'
        )
        .orderBy('companies.created_at', 'desc');
    }
    
    // Transform the data to match frontend expectations
    console.log('Raw organizations data:', organizations);
    const transformedOrganizations = organizations.map(org => {
      console.log('Processing org:', {
        name: org.name,
        trial_end_date: org.trial_end_date,
        daysLeft: org.daysLeft,
        plan: org.plan
      });
      
      // Calculate days left properly
      let calculatedDaysLeft = 0;
      if (org.trial_end_date) {
        const trialEndDate = new Date(org.trial_end_date);
        const currentDate = new Date();
        const diffTime = trialEndDate - currentDate;
        calculatedDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        console.log(`Days calculation for ${org.name}:`, {
          trial_end_date: org.trial_end_date,
          current_date: currentDate.toISOString().split('T')[0],
          calculated_days_left: calculatedDaysLeft
        });
      }
      
      return {
        id: org.id?.toString() || '',
        name: org.name || '',
        email: '', // No email field in companies table
        owner: org.owner || '',
        status: calculatedDaysLeft < 0 ? 'expired' : 
                 (org.trial_end_date && calculatedDaysLeft >= 0) ? 'trial' : 
                 (org.plan?.toLowerCase() === 'trial' || org.plan?.toLowerCase() === 'basic') ? 'trial' : 'active',
        plan: org.plan || 'Starter',
        users: org.user_count || 0, // Use user_count from query
        storage: '0MB', // No used storage field available
        totalStorage: `${org.totalStorage || 2}GB`,
        daysLeft: Number(calculatedDaysLeft), // Ensure it's a number
        revenue: org.revenue ? `₹${org.revenue}.00` : '₹0.00',
        createdAt: org.created_at,
        updatedAt: org.updated_at,
        lastLogin: null // Can be added if needed
      };
    });
    
    res.json({ 
      success: true, 
      data: transformedOrganizations 
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch organizations' 
    });
  }
};

// Get single company by ID
const getOrganizationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    console.log('Get organization by ID - User info:', { 
      userRole: req.user.role, 
      userType: req.user.type,
      company_id: company_id,
      requestedId: id
    });
    
    let organization;
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      organization = await db('companies').where({ id }).first();
    } else {
      organization = await db('companies')
        .where({ id, company_id })
        .first();
    }
      
    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    
    res.json({ 
      success: true, 
      data: organization 
    });
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch organization' 
    });
  }
};

// Create new company
const createOrganization = async (req, res) => {
  try {
    const { company_id } = req.user;
    const organizationData = {
      company_id: uuidv4(), // Generate unique company_id
      ...req.body,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    await db('companies').insert(organizationData);
    
    res.status(201).json({ 
      success: true,
      message: 'Organization created successfully', 
      data: organizationData
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create organization' 
    });
  }
};

// Update company
const updateOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    console.log('Update organization - User info:', { 
      userRole: req.user.role, 
      userType: req.user.type,
      company_id: company_id,
      organizationId: id
    });
    
    let organization;
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      organization = await db('companies').where({ id }).first();
    } else {
      organization = await db('companies')
        .where({ id, company_id })
        .first();
    }
      
    if (!organization) {
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }
    
    const updateData = {
      ...req.body,
      updated_at: new Date()
    };
    
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      await db('companies').where({ id }).update(updateData);
    } else {
      await db('companies')
        .where({ id, company_id })
        .update(updateData);
    }
      
    res.json({ 
      success: true,
      message: 'Organization updated successfully' 
    });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update organization' 
    });
  }
};

// Delete company
const deleteOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    console.log('Delete organization - User info:', { 
      userRole: req.user.role, 
      userType: req.user.type,
      company_id: company_id,
      organizationId: id
    });
    
    // First check if there are any users associated with this company
    let users;
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      users = await db('users').where({ company_id: id }).first();
    } else {
      users = await db('users')
        .where({ company_id: id, company_id })
        .first();
    }
      
    if (users) {
      return res.status(400).json({ 
        success: false,
        error: 'Cannot delete organization with associated users' 
      });
    }
    
    let deleted;
    if (req.user.role === 'superadmin' || req.user.type === 'superadmin') {
      deleted = await db('companies').where({ id }).del();
    } else {
      deleted = await db('companies')
        .where({ id, company_id })
        .del();
    }
      
    if (!deleted) {
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Organization deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete organization' 
    });
  }
};

module.exports = {
  getOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization
};
