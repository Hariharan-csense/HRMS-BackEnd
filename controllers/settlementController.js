const db = require('../db/db');

const { sendEmail } = require('../utils/mailer');



// Get all settlements

const getAllSettlements = async (req, res) => {

  try {

    const { company_id } = req.user;

    const { status, search, page = 1, limit = 10 } = req.query;

    

    let query = db('settlements')

      .select([

        'settlements.*',

        'employees.first_name',

        'employees.last_name',

        'employees.employee_id',

        'employees.status as employee_status',

        'departments.name as department'

      ])

      .leftJoin('employees', 'settlements.employee_id', 'employees.id')

      .leftJoin('departments', 'employees.department_id', 'departments.id')

      .where('settlements.company_id', company_id)

      .orderBy('settlements.created_at', 'desc');



    // Filter by status

    if (status && status !== 'all') {

      query = query.where('settlements.status', status);

    }



    // Search functionality

    if (search) {

      query = query.where(function() {

        this.where('employees.first_name', 'ilike', `%${search}%`)

            .orWhere('employees.last_name', 'ilike', `%${search}%`)

            .orWhere('employees.employee_id', 'ilike', `%${search}%`)

            .orWhere('departments.name', 'ilike', `%${search}%`);

      });

    }



    // Pagination

    const offset = (page - 1) * limit;

    const settlements = await query.limit(limit).offset(offset);

    

    // Transform data to include employee_name

    const transformedSettlements = settlements.map(settlement => ({

      ...settlement,

      employee_name: settlement.first_name && settlement.last_name 

        ? `${settlement.first_name} ${settlement.last_name}`.trim()

        : settlement.first_name || 'Unknown'

    }));

    

    // Get total count

    const totalCount = await query.clone().clearSelect().clearOrder().count('* as total').first();

    

    res.json({

      settlements: transformedSettlements,

      pagination: {

        page: parseInt(page),

        limit: parseInt(limit),

        total: parseInt(totalCount.total),

        pages: Math.ceil(totalCount.total / limit)

      }

    });

  } catch (error) {

    console.error('Error fetching settlements:', error);

    res.status(500).json({ error: 'Failed to fetch settlements' });

  }

};



// Get settlement by ID

const getSettlementById = async (req, res) => {

  try {

    const { id } = req.params;

    const { company_id } = req.user;

    

    const settlement = await db('settlements')

      .select([

        'settlements.*',

        'employees.first_name',

        'employees.last_name',

        'employees.employee_id',

        'employees.email',

        'employees.doj',

        'payroll_structures.basic',

        'payroll_structures.hra',

        'payroll_structures.allowances',

        'payroll_structures.incentives',

        'payroll_structures.gross',

        'departments.name as department',

        'designations.name as designation'

      ])

      .leftJoin('employees', 'settlements.employee_id', 'employees.id')

      .leftJoin('payroll_structures', 'employees.id', 'payroll_structures.employee_id')

      .leftJoin('departments', 'employees.department_id', 'departments.id')

      .leftJoin('designations', 'employees.designation_id', 'designations.id')

      .where('settlements.id', id)

      .where('settlements.company_id', company_id)

      .first();



    if (!settlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    // Transform settlement to include employee_name

    const transformedSettlement = {

      ...settlement,

      employee_name: settlement.first_name && settlement.last_name 

        ? `${settlement.first_name} ${settlement.last_name}`.trim()

        : settlement.first_name || 'Unknown'

    };



    // Get settlement components

    const components = await db('settlement_components')

      .where('settlement_id', id)

      .orderBy('created_at', 'asc');



    // Get settlement documents

    const documents = await db('settlement_documents')

      .where('settlement_id', id)

      .orderBy('created_at', 'desc');



    res.json({

      settlement: transformedSettlement,

      components,

      documents

    });

  } catch (error) {

    console.error('Error fetching settlement:', error);

    res.status(500).json({ error: 'Failed to fetch settlement' });

  }

};



// Create new settlement

const createSettlement = async (req, res) => {

  try {

    const { company_id } = req.user;

    const {

      employeeId,

      resignationDate,

      lastWorkingDay,

      remarks

    } = req.body;



    // Validate employee exists and belongs to company

    const employee = await db('employees')

      .where('id', employeeId)

      .where('company_id', company_id)

      .first();



    if (!employee) {

      return res.status(404).json({ error: 'Employee not found' });

    }



    // Check if settlement already exists for this employee

    const existingSettlement = await db('settlements')

      .where('employee_id', employeeId)

      .where('status', '!=', 'rejected')

      .first();



    if (existingSettlement) {

      return res.status(400).json({ error: 'Settlement already exists for this employee' });

    }



    // Create settlement

    await db('settlements')

      .insert({

        employee_id: employeeId,

        company_id: company_id,

        resignation_date: resignationDate,

        last_working_day: lastWorkingDay,

        status: 'pending',

        total_earnings: 0,

        total_deductions: 0,

        net_amount: 0,

        remarks: remarks || null,

        created_at: new Date(),

        updated_at: new Date()

      });



    // Get the created settlement with employee details

    const newSettlement = await db('settlements')

      .select([

        'settlements.*',

        'employees.first_name',

        'employees.last_name',

        'employees.employee_id',

        'departments.name as department',

        'designations.name as designation'

      ])

      .leftJoin('employees', 'settlements.employee_id', 'employees.id')

      .leftJoin('departments', 'employees.department_id', 'departments.id')

      .leftJoin('designations', 'employees.designation_id', 'designations.id')

      .where('settlements.employee_id', employeeId)

      .orderBy('settlements.created_at', 'desc')

      .first();



    // Send notification to HR

    try {

      await sendEmail({

        to: req.user.email,

        subject: 'New F&F Settlement Created',

        template: 'settlement-created',

        data: {

          employeeName: employee.name,

          employeeCode: employee.employee_id,

          resignationDate,

          lastWorkingDay

        }

      });

    } catch (emailError) {

      console.error('Error sending email notification:', emailError);

    }



    // Transform settlement to include employee_name

    const transformedSettlement = {

      ...newSettlement,

      employee_name: newSettlement.first_name && newSettlement.last_name 

        ? `${newSettlement.first_name} ${newSettlement.last_name}`.trim()

        : newSettlement.first_name || 'Unknown'

    };



    res.status(201).json(transformedSettlement);

  } catch (error) {

    console.error('Error creating settlement:', error);

    res.status(500).json({ error: 'Failed to create settlement' });

  }

};



// Update settlement

const updateSettlement = async (req, res) => {

  try {

    const { id } = req.params;

    const { company_id } = req.user;

    const updateData = req.body;



    // Verify settlement exists and belongs to company

    const existingSettlement = await db('settlements')

      .where('id', id)

      .where('company_id', company_id)

      .first();



    if (!existingSettlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    // Update settlement

    await db('settlements')

      .where('id', id)

      .update({

        ...updateData,

        updated_at: new Date()

      });



    // Get the updated settlement

    const updatedSettlement = await db('settlements')

      .where('id', id)

      .first();



    res.json(updatedSettlement);

  } catch (error) {

    console.error('Error updating settlement:', error);

    res.status(500).json({ error: 'Failed to update settlement' });

  }

};



// Calculate settlement components
const calculateSettlement = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;

    const settlement = await db('settlements')
      .select([
        'settlements.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id',
        'employees.doj',
        'payroll_structures.basic',
        'payroll_structures.hra',
        'payroll_structures.allowances',
        'payroll_structures.incentives',
        'payroll_structures.gross',
        'payroll_structures.pf',
        'payroll_structures.esi',
        'payroll_structures.pt',
        'payroll_structures.tds',
        'payroll_structures.other_deductions',
        'departments.name as department',
        'designations.name as designation'
      ])
      .leftJoin('employees', 'settlements.employee_id', 'employees.id')
      .leftJoin('payroll_structures', 'employees.id', 'payroll_structures.employee_id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('settlements.id', id)
      .where('settlements.company_id', company_id)
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (!settlement.gross) {
      return res.status(400).json({ 
        error: 'Payroll structure not found for this employee. Please set up the salary structure first.' 
      });
    }

    // Clear existing components
    await db('settlement_components').where('settlement_id', id).del();

    const components = [];
    let totalEarnings = 0;
    let totalDeductions = 0;

    // Calculate final month salary (pro-rata)
    const lastWorkingDay = new Date(settlement.last_working_day);
    const resignationDate = new Date(settlement.resignation_date);
    const daysInMonth = new Date(lastWorkingDay.getFullYear(), lastWorkingDay.getMonth() + 1, 0).getDate();
    const workingDays = Math.min(lastWorkingDay.getDate(), daysInMonth);
    const monthlyGross = settlement.gross || 0;
    const finalMonthSalary = (monthlyGross / daysInMonth) * workingDays;

    // Add final month salary
    components.push({
      settlement_id: id,
      name: 'Final Month Salary',
      type: 'earning',
      amount: Math.round(finalMonthSalary),
      is_taxable: true,
      description: `Pro-rata salary for ${workingDays} days`,
      created_at: new Date()
    });
    totalEarnings += Math.round(finalMonthSalary);

    // Calculate leave encashment (simplified calculation)
    const yearsOfService = (new Date() - new Date(settlement.doj)) / (365.25 * 24 * 60 * 60 * 1000);
    const leaveBalance = Math.floor(yearsOfService * 18); // 18 days per year
    const leaveEncashment = (monthlyGross / 30) * Math.min(leaveBalance, 30); // Max 30 days

    if (leaveEncashment > 0) {
      components.push({
        settlement_id: id,
        name: 'Leave Encashment',
        type: 'earning',
        amount: Math.round(leaveEncashment),
        is_taxable: true,
        description: `Encashment for ${Math.min(leaveBalance, 30)} days`,
        created_at: new Date()
      });
      totalEarnings += Math.round(leaveEncashment);
    }

    // Calculate gratuity (if 5+ years of service)
    if (yearsOfService >= 5) {
      const gratuity = (monthlyGross * 15 * yearsOfService) / 26; // Gratuity formula
      components.push({
        settlement_id: id,
        name: 'Gratuity',
        type: 'earning',
        amount: Math.round(gratuity),
        is_taxable: false,
        description: `Gratuity for ${yearsOfService.toFixed(1)} years of service`,
        created_at: new Date()
      });
      totalEarnings += Math.round(gratuity);
    }

    // Calculate notice period recovery (if applicable)
    const noticePeriodDays = 30; // Standard notice period
    const actualNoticeDays = Math.max(0, noticePeriodDays - Math.ceil((lastWorkingDay - resignationDate) / (1000 * 60 * 60 * 24)));

    if (actualNoticeDays > 0) {
      const noticeRecovery = (monthlyGross / 30) * actualNoticeDays;
      components.push({
        settlement_id: id,
        name: 'Notice Period Recovery',
        type: 'deduction',
        amount: Math.round(noticeRecovery),
        is_taxable: false,
        description: `Recovery for ${actualNoticeDays} days notice period`,
        created_at: new Date()
      });
      totalDeductions += Math.round(noticeRecovery);
    }

    // Add standard payroll deductions
    const standardDeductions = {
      pf: parseFloat(settlement.pf || 0),
      esi: parseFloat(settlement.esi || 0),
      pt: parseFloat(settlement.pt || 0),
      tds: parseFloat(settlement.tds || 0),
      other_deductions: parseFloat(settlement.other_deductions || 0)
    };

    const totalStandardDeductions = Object.values(standardDeductions).reduce((sum, val) => sum + val, 0);

    if (totalStandardDeductions > 0) {
      // Add individual deduction components
      Object.entries(standardDeductions).forEach(([key, amount]) => {
        if (amount > 0) {
          const nameMap = {
            pf: 'Provident Fund',
            esi: 'ESI',
            pt: 'Professional Tax',
            tds: 'TDS',
            other_deductions: 'Other Deductions'
          };
          
          components.push({
            settlement_id: id,
            name: nameMap[key] || key,
            type: 'deduction',
            amount: Math.round(amount),
            is_taxable: false,
            description: `${nameMap[key] || key} deduction`,
            created_at: new Date()
          });
        }
      });

      totalDeductions += Math.round(totalStandardDeductions);
    }

    // Insert components
    await db('settlement_components').insert(components);

    // Update settlement totals
    const netAmount = totalEarnings - totalDeductions;
    await db('settlements')
      .where('id', id)
      .update({
        total_earnings: totalEarnings,
        total_deductions: totalDeductions,
        net_amount: netAmount,
        status: 'calculated',
        updated_at: new Date()
      });

    res.json({
      message: 'Settlement calculated successfully',
      components,
      totalEarnings,
      totalDeductions,
      netAmount
    });

  } catch (error) {
    console.error('Error calculating settlement:', error);
    res.status(500).json({ error: 'Failed to calculate settlement' });
  }
};



// Approve settlement

const approveSettlement = async (req, res) => {

  try {

    const { id } = req.params;

    const { company_id } = req.user;

    const { paymentMode, paymentReference, settlementDate } = req.body;



    const settlement = await db('settlements')

      .where('id', id)

      .where('company_id', company_id)

      .first();



    if (!settlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    if (settlement.status !== 'processing') {

      return res.status(400).json({ error: 'Settlement must be in processing status to approve' });

    }



    // Update settlement

    await db('settlements')

      .where('id', id)

      .update({

        status: 'completed',

        payment_mode: paymentMode,

        payment_reference: paymentReference,

        settlement_date: settlementDate || new Date(),

        updated_at: new Date()

      });



    // Get the updated settlement

    const updatedSettlement = await db('settlements')

      .where('id', id)

      .first();



    // Get employee details for notification

    const employee = await db('employees')

      .where('id', settlement.employee_id)

      .first();



    // Send notification to employee

    try {

      await sendEmail({

        to: employee.email,

        subject: 'F&F Settlement Completed',

        template: 'settlement-completed',

        data: {

          employeeName: employee.name,

          netAmount: settlement.net_amount,

          paymentMode,

          settlementDate: settlementDate || new Date()

        }

      });

    } catch (emailError) {

      console.error('Error sending email notification:', emailError);

    }



    res.json(updatedSettlement);

  } catch (error) {

    console.error('Error approving settlement:', error);

    res.status(500).json({ error: 'Failed to approve settlement' });

  }

};



// Reject settlement

const rejectSettlement = async (req, res) => {

  try {

    const { id } = req.params;

    const { company_id } = req.user;

    const { rejectionReason } = req.body;



    const settlement = await db('settlements')

      .where('id', id)

      .where('company_id', company_id)

      .first();



    if (!settlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    // Update settlement

    await db('settlements')

      .where('id', id)

      .update({

        status: 'rejected',

        remarks: rejectionReason,

        updated_at: new Date()

      });



    // Get the updated settlement

    const updatedSettlement = await db('settlements')

      .where('id', id)

      .first();



    res.json(updatedSettlement);

  } catch (error) {

    console.error('Error rejecting settlement:', error);

    res.status(500).json({ error: 'Failed to reject settlement' });

  }

};



// Get employees for settlement

const getEmployeesForSettlement = async (req, res) => {

  try {

    const { company_id } = req.user;

    const { search } = req.query;



    let query = db('employees')

      .select([

        'employees.id',

        'employees.first_name',

        'employees.last_name',

        'employees.employee_id',

        'employees.email',

        'employees.status',

        'departments.name as department',

        'designations.name as designation'

      ])

      .leftJoin('departments', 'employees.department_id', 'departments.id')

      .leftJoin('designations', 'employees.designation_id', 'designations.id')

      .where('employees.company_id', company_id)

      .where('employees.status', 'Active');



    if (search) {

      query = query.where(function() {

        this.where('employees.first_name', 'ilike', `%${search}%`)

            .orWhere('employees.last_name', 'ilike', `%${search}%`)

            .orWhere('employees.employee_id', 'ilike', `%${search}%`);

      });

    }



    const employees = await query.orderBy('employees.first_name', 'asc');

    

    // Transform employees to include name field

    const transformedEmployees = employees.map(employee => ({

      ...employee,

      name: employee.first_name && employee.last_name 

        ? `${employee.first_name} ${employee.last_name}`.trim()

        : employee.first_name || 'Unknown'

    }));

    

    res.json(transformedEmployees);

  } catch (error) {

    console.error('Error fetching employees:', error);

    res.status(500).json({ error: 'Failed to fetch employees' });

  }

};



// Download settlement report

const downloadSettlementReport = async (req, res) => {

  try {

    const { id } = req.params;

    const { company_id } = req.user;



    const settlement = await db('settlements')

      .select([

        'settlements.*',

        'employees.first_name',

        'employees.last_name',

        'employees.employee_id',

        'employees.email',

        'payroll_structures.basic',

        'payroll_structures.hra',

        'payroll_structures.allowances',

        'payroll_structures.incentives',

        'payroll_structures.gross',

        'departments.name as department',

        'designations.name as designation'

      ])

      .leftJoin('employees', 'settlements.employee_id', 'employees.id')

      .leftJoin('payroll_structures', 'employees.id', 'payroll_structures.employee_id')

      .leftJoin('departments', 'employees.department_id', 'departments.id')

      .leftJoin('designations', 'employees.designation_id', 'designations.id')

      .where('settlements.id', id)

      .where('settlements.company_id', company_id)

      .first();



    if (!settlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    // Transform settlement to include employee_name

    const transformedSettlement = {

      ...settlement,

      employee_name: settlement.first_name && settlement.last_name 

        ? `${settlement.first_name} ${settlement.last_name}`.trim()

        : settlement.first_name || 'Unknown'

    };



    const components = await db('settlement_components')

      .where('settlement_id', id)

      .orderBy('type', 'asc')

      .orderBy('created_at', 'asc');



    // Generate PDF report (implementation would depend on your PDF library)

    // For now, return JSON data that can be used to generate PDF

    res.json({

      settlement: transformedSettlement,

      components,

      reportGeneratedAt: new Date()

    });

  } catch (error) {

    console.error('Error generating settlement report:', error);

    res.status(500).json({ error: 'Failed to generate settlement report' });

  }

};



// Send settlement email

const sendSettlementEmail = async (req, res) => {

  try {

    const { company_id } = req.user;

    const { settlementId, employeeEmail, employeeName, netAmount, status } = req.body;



    // Verify settlement exists and belongs to company

    const settlement = await db('settlements')

      .where('id', settlementId)

      .where('company_id', company_id)

      .first();



    if (!settlement) {

      return res.status(404).json({ error: 'Settlement not found' });

    }



    // Send email to employee

    try {

      await sendEmail({

        to: employeeEmail,

        subject: `F&F Settlement Update - ${status.charAt(0).toUpperCase() + status.slice(1)}`,

        template: 'settlement-update',

        data: {

          employeeName,

          netAmount,

          status,

          settlementDate: settlement.settlement_date,

          lastWorkingDay: settlement.last_working_day

        }

      });

    } catch (emailError) {

      console.error('Error sending email notification:', emailError);

    }



    res.json({ message: 'Settlement email sent successfully' });

  } catch (error) {

    console.error('Error sending settlement email:', error);

    res.status(500).json({ error: 'Failed to send settlement email' });

  }

};



module.exports = {

  getAllSettlements,

  getSettlementById,

  createSettlement,

  updateSettlement,

  calculateSettlement,

  approveSettlement,

  rejectSettlement,

  getEmployeesForSettlement,

  downloadSettlementReport,

  sendSettlementEmail

};

