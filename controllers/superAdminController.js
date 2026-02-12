const knex = require('../db/db');

// @desc    Get all companies with user counts
// @route   GET /api/superadmin/companies
// @access  Super Admin only
const getAllCompanies = async (req, res) => {
  try {
    const companies = await knex('companies')
      .select([
        'companies.id',
        'companies.company_id',
        'companies.company_name',
        'companies.legal_name',
        'companies.gstin_pan',
        'companies.industry',
        'companies.timezone',
        'companies.payroll_cycle',
        'companies.address',
        'companies.created_at',
        'companies.updated_at',
        knex.raw('COUNT(DISTINCT employees.id) as user_count'),
        knex.raw('COUNT(DISTINCT users.id) as active_user_count')
      ])
      .leftJoin('employees', 'companies.id', 'employees.company_id')
      .leftJoin('users', 'employees.email', 'users.email')
      .groupBy('companies.id', 'companies.company_id', 'companies.company_name', 'companies.legal_name', 'companies.gstin_pan', 'companies.industry', 'companies.timezone', 'companies.payroll_cycle', 'companies.address', 'companies.created_at', 'companies.updated_at')
      .orderBy('companies.created_at', 'desc');

    res.status(200).json({
      success: true,
      data: companies
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch companies',
      error: error.message
    });
  }
};

// @desc    Get all tickets with organization details
// @route   GET /api/superadmin/tickets
// @access  Super Admin only
const getAllTickets = async (req, res) => {
  try {
    const { status, priority, category, company_id, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = knex('tickets')
      .select([
        'tickets.id',
        'tickets.ticket_number',
        'tickets.title',
        'tickets.description',
        'tickets.priority',
        'tickets.category',
        'tickets.status',
        'tickets.assigned_to',
        'tickets.created_by',
        'tickets.company_id',
        'tickets.created_at',
        'tickets.updated_at',
        'creator.name as creator_name',
        'creator.email as creator_email',
        'assigned.name as assigned_name',
        'assigned.email as assigned_email',
        'companies.company_name',
        'companies.company_id as company_identifier'
      ])
      .leftJoin('users as creator', 'tickets.created_by', 'creator.id')
      .leftJoin('users as assigned', 'tickets.assigned_to', 'assigned.id')
      .leftJoin('companies', 'tickets.company_id', 'companies.id')
      .orderBy('tickets.created_at', 'desc');

    // Apply filters
    if (status) {
      query = query.where('tickets.status', status);
    }
    if (priority) {
      query = query.where('tickets.priority', priority);
    }
    if (category) {
      query = query.where('tickets.category', category);
    }
    if (company_id) {
      query = query.where('tickets.company_id', company_id);
    }

    // Get total count for pagination
    const countQuery = knex('tickets')
      .count('* as total');
    if (status) countQuery.where('status', status);
    if (priority) countQuery.where('priority', priority);
    if (category) countQuery.where('category', category);
    if (company_id) countQuery.where('company_id', company_id);
    const [{ total }] = await countQuery;

    // Get paginated results
    const tickets = await query.limit(limit).offset(offset);

    // Format tickets
    const formattedTickets = tickets.map(ticket => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      status: ticket.status,
      assignedTo: ticket.assigned_to ? {
        id: ticket.assigned_to,
        name: ticket.assigned_name,
        email: ticket.assigned_email
      } : null,
      createdBy: {
        name: ticket.creator_name,
        email: ticket.creator_email
      },
      organization: ticket.company_id ? {
        id: ticket.company_id,
        name: ticket.company_name,
        companyId: ticket.company_identifier
      } : null,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at
    }));

    res.status(200).json({
      success: true,
      data: formattedTickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
      error: error.message
    });
  }
};

// @desc    Get super admin dashboard statistics
// @route   GET /api/superadmin/stats
// @access  Super Admin only
const getDashboardStats = async (req, res) => {
  try {
    // Get company statistics
    const companyStats = await knex('companies')
      .count('* as total_companies')
      .first();

    // Get user statistics
    const userStats = await knex('employees')
      .select([
        knex.raw('COUNT(*) as total_users'),
        knex.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as active_users', ['Active'])
      ])
      .first();

    // Get ticket statistics
    const ticketStats = await knex('tickets')
      .select([
        knex.raw('COUNT(*) as total_tickets'),
        knex.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as resolved_tickets', ['resolved'])
      ])
      .first();

    // Calculate resolution rate
    const totalTickets = parseInt(ticketStats.total_tickets) || 0;
    const resolvedTickets = parseInt(ticketStats.resolved_tickets) || 0;
    const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

    // Get organization-wise ticket counts
    const orgTicketStats = await knex('companies')
      .select([
        'companies.id as organization_id',
        'companies.company_name as organization_name',
        knex.raw('COUNT(tickets.id) as ticket_count'),
        knex.raw('SUM(CASE WHEN tickets.status = ? THEN 1 ELSE 0 END) as resolved_count', ['resolved'])
      ])
      .leftJoin('tickets', 'companies.id', 'tickets.company_id')
      .groupBy('companies.id', 'companies.company_name')
      .orderBy('companies.id', 'asc');

    // Format organization stats
    const organizations = orgTicketStats.map(org => ({
      id: org.organization_id,
      name: org.organization_name || 'Unassigned',
      ticketCount: parseInt(org.ticket_count) || 0,
      resolvedTickets: parseInt(org.resolved_count) || 0,
      resolutionRate: org.ticket_count > 0 ? Math.round((org.resolved_count / org.ticket_count) * 100) : 0
    }));

    // Get user counts per organization
    const orgUserStats = await knex('companies')
      .select([
        'companies.id',
        'companies.company_name',
        knex.raw('COUNT(DISTINCT employees.id) as user_count')
      ])
      .leftJoin('employees', 'companies.id', 'employees.company_id')
      .groupBy('companies.id', 'companies.company_name')
      .orderBy('user_count', 'desc');

    // Combine organization data
    const organizationsWithUsers = organizations.map(org => {
      const userStats = orgUserStats.find(userOrg => userOrg.id === org.id);
      return {
        ...org,
        userCount: userStats ? parseInt(userStats.user_count) || 0 : 0
      };
    });

    const stats = {
      totalOrganizations: parseInt(companyStats.total_companies) || 0,
      activeOrganizations: parseInt(companyStats.total_companies) || 0, // All companies are considered active
      totalUsers: parseInt(userStats.total_users) || 0,
      activeUsers: parseInt(userStats.active_users) || 0,
      totalTickets: totalTickets,
      resolvedTickets: resolvedTickets,
      resolutionRate: resolutionRate,
      organizations: organizationsWithUsers
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};

// @desc    Get tickets by organization ID
// @route   GET /api/superadmin/organizations/:id/tickets
// @access  Super Admin only
const getTicketsByOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, category, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Verify organization exists
    const organization = await knex('companies').where('id', id).first();
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    let query = knex('tickets')
      .select([
        'tickets.id',
        'tickets.ticket_number',
        'tickets.title',
        'tickets.description',
        'tickets.priority',
        'tickets.category',
        'tickets.status',
        'tickets.assigned_to',
        'tickets.created_by',
        'tickets.created_at',
        'tickets.updated_at',
        'creator.name as creator_name',
        'creator.email as creator_email',
        'assigned.name as assigned_name',
        'assigned.email as assigned_email'
      ])
      .leftJoin('users as creator', 'tickets.created_by', 'creator.id')
      .leftJoin('users as assigned', 'tickets.assigned_to', 'assigned.id')
      .where('tickets.company_id', id)
      .orderBy('tickets.created_at', 'desc');

    // Apply filters
    if (status) {
      query = query.where('tickets.status', status);
    }
    if (priority) {
      query = query.where('tickets.priority', priority);
    }
    if (category) {
      query = query.where('tickets.category', category);
    }

    // Get total count for pagination
    const countQuery = knex('tickets')
      .count('* as total')
      .where('company_id', id);
    if (status) countQuery.where('status', status);
    if (priority) countQuery.where('priority', priority);
    if (category) countQuery.where('category', category);
    const [{ total }] = await countQuery;

    // Get paginated results
    const tickets = await query.limit(limit).offset(offset);

    // Format tickets
    const formattedTickets = tickets.map(ticket => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      status: ticket.status,
      assignedTo: ticket.assigned_to ? {
        id: ticket.assigned_to,
        name: ticket.assigned_name,
        email: ticket.assigned_email
      } : null,
      createdBy: {
        name: ticket.creator_name,
        email: ticket.creator_email
      },
      organization: {
        id: organization.id,
        name: organization.company_name
      },
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at
    }));

    res.status(200).json({
      success: true,
      data: formattedTickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching organization tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organization tickets',
      error: error.message
    });
  }
};

// @desc    Get organization statistics with subscription details
// @route   GET /api/superadmin/organization-stats
// @access  Super Admin only
const getOrganizationStats = async (req, res) => {
  try {
    // Get all organizations with their subscription details using a simpler approach
    const organizationsQuery = `
      SELECT 
        c.id,
        c.company_name,
        c.created_at as company_created_at,
        cs.id as subscription_id,
        cs.status as subscription_status,
        cs.start_date,
        cs.end_date,
        cs.trial_end_date,
        sp.name as plan_name,
        sp.price as plan_price,
        sp.max_users as plan_max_users,
        sp.billing_cycle,
        COALESCE(emp_counts.user_count, 0) as user_count
      FROM companies c
      LEFT JOIN (
        SELECT DISTINCT company_id, plan_id, status, start_date, end_date, trial_end_date, id,
               ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at DESC) as rn
        FROM company_subscriptions 
        WHERE status IN ('trial', 'active')
      ) cs ON c.id = cs.company_id AND cs.rn = 1
      LEFT JOIN subscription_plans sp ON cs.plan_id = sp.id
      LEFT JOIN (
        SELECT company_id, COUNT(DISTINCT id) as user_count
        FROM employees
        GROUP BY company_id
      ) emp_counts ON c.id = emp_counts.company_id
      ORDER BY c.created_at DESC
    `;

    const organizations = await knex.raw(organizationsQuery);

    // Calculate statistics
    const orgs = organizations[0] || [];
    const totalOrganizations = orgs.length;
    const trialOrganizations = orgs.filter(org => org.subscription_status === 'trial').length;
    const paidOrganizations = orgs.filter(org => org.subscription_status === 'active').length;
    const expiredOrganizations = orgs.filter(org => {
      if (!org.subscription_status) return true; // No subscription
      if (org.subscription_status === 'trial' && org.trial_end_date) {
        return new Date() > new Date(org.trial_end_date);
      }
      if (org.subscription_status === 'active' && org.end_date) {
        return new Date() > new Date(org.end_date);
      }
      return false;
    }).length;
    const noSubscriptionOrganizations = orgs.filter(org => !org.subscription_status).length;

    // Group by plan with organization details
    const planStats = {};
    orgs.forEach(org => {
      if (org.plan_name) {
        if (!planStats[org.plan_name]) {
          planStats[org.plan_name] = {
            planName: org.plan_name,
            price: org.plan_price,
            maxUsers: org.plan_max_users,
            billingCycle: org.billing_cycle,
            organizationCount: 0,
            trialCount: 0,
            activeCount: 0,
            totalUsers: 0,
            organizations: []
          };
        }
        planStats[org.plan_name].organizationCount++;
        planStats[org.plan_name].totalUsers += parseInt(org.user_count) || 0;
        
        // Add organization details to the plan
        planStats[org.plan_name].organizations.push({
          id: org.id,
          name: org.company_name,
          userCount: parseInt(org.user_count) || 0,
          subscriptionStatus: org.subscription_status || 'none',
          startDate: org.start_date,
          endDate: org.end_date,
          trialEndDate: org.trial_end_date
        });
        
        if (org.subscription_status === 'trial') {
          planStats[org.plan_name].trialCount++;
        } else if (org.subscription_status === 'active') {
          planStats[org.plan_name].activeCount++;
        }
      }
    });

    // Calculate total revenue
    const totalRevenue = orgs
      .filter(org => org.subscription_status === 'active' && org.plan_price)
      .reduce((sum, org) => {
        const price = parseFloat(org.plan_price);
        const cycle = org.billing_cycle;
        if (cycle === 'monthly') return sum + price;
        if (cycle === 'yearly') return sum + (price / 12); // Convert yearly to monthly for comparison
        return sum + price;
      }, 0);

    const stats = {
      overview: {
        totalOrganizations,
        trialOrganizations,
        paidOrganizations,
        expiredOrganizations,
        noSubscriptionOrganizations,
        totalRevenue: Math.round(totalRevenue)
      },
      planBreakdown: Object.values(planStats),
      organizations: orgs.map(org => ({
        id: org.id,
        name: org.company_name,
        userCount: parseInt(org.user_count) || 0,
        subscriptionStatus: org.subscription_status || 'none',
        planName: org.plan_name || 'No Plan',
        planPrice: org.plan_price || 0,
        billingCycle: org.billing_cycle || 'N/A',
        startDate: org.start_date,
        endDate: org.end_date,
        trialEndDate: org.trial_end_date,
        createdAt: org.company_created_at
      }))
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching organization stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organization statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllCompanies,
  getAllTickets,
  getDashboardStats,
  getTicketsByOrganization,
  getOrganizationStats
};
