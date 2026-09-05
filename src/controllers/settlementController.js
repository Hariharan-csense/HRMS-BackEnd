const db = require('../db/db');
const { sendEmail } = require('../utils/mailer');
const { getDateKey } = require('../utils/dateTime');

const buildEmployeeName = (record) =>
  `${record?.first_name || ''} ${record?.last_name || ''}`.trim() || record?.first_name || 'Unknown';

const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');

const getNextNumericId = async (tableName) => {
  const result = await db(tableName).max('id as maxId').first();
  return Number(result?.maxId || 0) + 1;
};

const syncFinalSettlementChecklist = async (companyId, employeeId) => {
  if (!companyId || !employeeId) return;

  const resignation = await db('resignations')
    .where({ company_id: companyId, employee_id: employeeId })
    .orderBy('created_at', 'desc')
    .first();

  if (!resignation) return;

  const checklist = await db('offboarding_checklists')
    .where({ company_id: companyId, resignation_id: resignation.id })
    .first();

  if (!checklist) return;

  const nextChecklist = {
    hr_clearance: !!checklist.hr_clearance,
    finance_clearance: !!checklist.finance_clearance,
    asset_return: !!checklist.asset_return,
    it_clearance: !!checklist.it_clearance,
    final_settlement: true,
  };

  const allDone = Object.values(nextChecklist).every(Boolean);

  await db('offboarding_checklists')
    .where({ id: checklist.id, company_id: companyId })
    .update({
      final_settlement: true,
      status: allDone ? 'completed' : 'in-progress',
      completed_date: allDone ? getDateKey() : null,
    });

  if (allDone) {
    await db('employees')
      .where({ id: employeeId, company_id: companyId })
      .update({ status: 'Inactive' });
  }
};

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
        'departments.name as department',
        'designations.name as designation',
      ])
      .leftJoin('employees', 'settlements.employee_id', 'employees.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('settlements.company_id', company_id)
      .orderBy('settlements.created_at', 'desc');

    if (status && status !== 'all') {
      query = query.where('settlements.status', status);
    }

    if (search) {
      const searchPattern = `%${escapeLike(search)}%`;
      query = query.where(function () {
        this.where('employees.first_name', 'like', searchPattern)
          .orWhere('employees.last_name', 'like', searchPattern)
          .orWhere('employees.employee_id', 'like', searchPattern)
          .orWhere('departments.name', 'like', searchPattern);
      });
    }

    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;
    const offset = (pageNumber - 1) * limitNumber;

    const settlements = await query.clone().limit(limitNumber).offset(offset);
    const totalCount = await query.clone().clearSelect().clearOrder().count('* as total').first();

    const transformedSettlements = settlements.map((settlement) => ({
      ...settlement,
      employee_name: buildEmployeeName(settlement),
    }));

    res.json({
      settlements: transformedSettlements,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: parseInt(totalCount?.total || 0, 10),
        pages: Math.ceil(parseInt(totalCount?.total || 0, 10) / limitNumber),
      },
    });
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
};

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
        'payroll_structures.pf',
        'payroll_structures.esi',
        'payroll_structures.pt',
        'payroll_structures.tds',
        'payroll_structures.other_deductions',
        'departments.name as department',
        'designations.name as designation',
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

    const components = await db('settlement_components')
      .where('settlement_id', id)
      .orderBy([{ column: 'type', order: 'asc' }, { column: 'created_at', order: 'asc' }]);

    const documents = await db('settlement_documents')
      .where('settlement_id', id)
      .orderBy('created_at', 'desc');

    res.json({
      settlement: {
        ...settlement,
        employee_name: buildEmployeeName(settlement),
      },
      components,
      documents,
    });
  } catch (error) {
    console.error('Error fetching settlement:', error);
    res.status(500).json({ error: 'Failed to fetch settlement' });
  }
};

const createSettlement = async (req, res) => {
  try {
    const { company_id } = req.user;
    const { employeeId, resignationDate, lastWorkingDay, remarks } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'Employee is required' });
    }

    const employee = await db('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .select(
        'employees.*',
        'departments.name as department',
        'designations.name as designation'
      )
      .where('employees.id', employeeId)
      .where('employees.company_id', company_id)
      .first();

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const resignation = await db('resignations')
      .where({ company_id, employee_id: employeeId, approval_status: 'approved' })
      .orderBy('created_at', 'desc')
      .first();

    const finalResignationDate = resignationDate || resignation?.resignation_date;
    const finalLastWorkingDay = lastWorkingDay || resignation?.last_working_day;

    if (!finalResignationDate || !finalLastWorkingDay) {
      return res.status(400).json({
        error: 'Resignation date and last working day are required. Approve resignation first or enter both dates.',
      });
    }

    const existingSettlement = await db('settlements')
      .where('employee_id', employeeId)
      .where('company_id', company_id)
      .where('status', '!=', 'rejected')
      .first();

    if (existingSettlement) {
      return res.status(400).json({ error: 'Settlement already exists for this employee' });
    }

    const nextSettlementId = await getNextNumericId('settlements');

    const inserted = await db('settlements').insert({
      id: nextSettlementId,
      employee_id: employeeId,
      company_id,
      resignation_date: finalResignationDate,
      last_working_day: finalLastWorkingDay,
      status: 'pending',
      total_earnings: 0,
      total_deductions: 0,
      net_amount: 0,
      remarks: remarks || null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const settlementId = Array.isArray(inserted) ? inserted[0] : inserted;

    const newSettlement = await db('settlements')
      .select([
        'settlements.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id',
        'departments.name as department',
        'designations.name as designation',
      ])
      .leftJoin('employees', 'settlements.employee_id', 'employees.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('settlements.id', settlementId)
      .first();

    try {
      await sendEmail({
        to: req.user.email,
        subject: 'New F&F Settlement Created',
        template: 'settlement-created',
        data: {
          employeeName: buildEmployeeName(employee),
          employeeCode: employee.employee_id,
          resignationDate: finalResignationDate,
          lastWorkingDay: finalLastWorkingDay,
        },
      });
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
    }

    res.status(201).json({
      ...newSettlement,
      employee_name: buildEmployeeName(newSettlement),
    });
  } catch (error) {
    console.error('Error creating settlement:', error);
    res.status(500).json({ error: 'Failed to create settlement' });
  }
};

const updateSettlement = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    const allowedFields = ['remarks', 'payment_mode', 'payment_reference', 'settlement_date'];
    const updateData = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
    );

    const existingSettlement = await db('settlements')
      .where('id', id)
      .where('company_id', company_id)
      .first();

    if (!existingSettlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (req.body?.status !== undefined) {
      const nextStatus = String(req.body.status || '').toLowerCase();
      const allowedStatusUpdates = ['pending', 'processing', 'calculated'];

      if (!allowedStatusUpdates.includes(nextStatus)) {
        return res.status(400).json({ error: 'Use approve or reject actions for final status updates' });
      }

      updateData.status = nextStatus;
    }

    await db('settlements')
      .where('id', id)
      .update({
        ...updateData,
        updated_at: new Date(),
      });

    const updatedSettlement = await db('settlements').where('id', id).first();
    res.json(updatedSettlement);
  } catch (error) {
    console.error('Error updating settlement:', error);
    res.status(500).json({ error: 'Failed to update settlement' });
  }
};

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
        'payroll_structures.gross',
        'payroll_structures.pf',
        'payroll_structures.esi',
        'payroll_structures.pt',
        'payroll_structures.tds',
        'payroll_structures.other_deductions',
      ])
      .leftJoin('employees', 'settlements.employee_id', 'employees.id')
      .leftJoin('payroll_structures', 'employees.id', 'payroll_structures.employee_id')
      .where('settlements.id', id)
      .where('settlements.company_id', company_id)
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (!settlement.gross) {
      return res.status(400).json({
        error: 'Payroll structure not found for this employee. Please set up the salary structure first.',
      });
    }

    await db('settlement_components').where('settlement_id', id).del();

    const components = [];
    let totalEarnings = 0;
    let totalDeductions = 0;
    let nextComponentId = await getNextNumericId('settlement_components');

    const lastWorkingDay = new Date(settlement.last_working_day);
    const resignationDate = new Date(settlement.resignation_date);
    const daysInMonth = new Date(lastWorkingDay.getFullYear(), lastWorkingDay.getMonth() + 1, 0).getDate();
    const workingDays = Math.min(lastWorkingDay.getDate(), daysInMonth);
    const monthlyGross = Number(settlement.gross || 0);
    const finalMonthSalary = (monthlyGross / daysInMonth) * workingDays;

    components.push({
      id: nextComponentId++,
      settlement_id: id,
      name: 'Final Month Salary',
      type: 'earning',
      amount: Math.round(finalMonthSalary),
      is_taxable: true,
      description: `Pro-rata salary for ${workingDays} days`,
      created_at: new Date(),
    });
    totalEarnings += Math.round(finalMonthSalary);

    const yearsOfService = settlement.doj
      ? (new Date() - new Date(settlement.doj)) / (365.25 * 24 * 60 * 60 * 1000)
      : 0;
    const leaveBalance = Math.floor(yearsOfService * 18);
    const leaveEncashment = (monthlyGross / 30) * Math.min(leaveBalance, 30);

    if (leaveEncashment > 0) {
      components.push({
        id: nextComponentId++,
        settlement_id: id,
        name: 'Leave Encashment',
        type: 'earning',
        amount: Math.round(leaveEncashment),
        is_taxable: true,
        description: `Encashment for ${Math.min(leaveBalance, 30)} days`,
        created_at: new Date(),
      });
      totalEarnings += Math.round(leaveEncashment);
    }

    if (yearsOfService >= 5) {
      const gratuity = (monthlyGross * 15 * yearsOfService) / 26;
      components.push({
        id: nextComponentId++,
        settlement_id: id,
        name: 'Gratuity',
        type: 'earning',
        amount: Math.round(gratuity),
        is_taxable: false,
        description: `Gratuity for ${yearsOfService.toFixed(1)} years of service`,
        created_at: new Date(),
      });
      totalEarnings += Math.round(gratuity);
    }

    const noticePeriodDays = 30;
    const servedDays = Math.max(
      0,
      Math.ceil((lastWorkingDay.getTime() - resignationDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const actualNoticeDays = Math.max(0, noticePeriodDays - servedDays);

    if (actualNoticeDays > 0) {
      const noticeRecovery = (monthlyGross / 30) * actualNoticeDays;
      components.push({
        id: nextComponentId++,
        settlement_id: id,
        name: 'Notice Period Recovery',
        type: 'deduction',
        amount: Math.round(noticeRecovery),
        is_taxable: false,
        description: `Recovery for ${actualNoticeDays} days notice period`,
        created_at: new Date(),
      });
      totalDeductions += Math.round(noticeRecovery);
    }

    const standardDeductions = {
      pf: parseFloat(settlement.pf || 0),
      esi: parseFloat(settlement.esi || 0),
      pt: parseFloat(settlement.pt || 0),
      tds: parseFloat(settlement.tds || 0),
      other_deductions: parseFloat(settlement.other_deductions || 0),
    };

    const totalStandardDeductions = Object.values(standardDeductions).reduce((sum, value) => sum + value, 0);

    if (totalStandardDeductions > 0) {
      Object.entries(standardDeductions).forEach(([key, amount]) => {
        if (amount <= 0) return;

        const nameMap = {
          pf: 'Provident Fund',
          esi: 'ESI',
          pt: 'Professional Tax',
          tds: 'TDS',
          other_deductions: 'Other Deductions',
        };

        components.push({
          id: nextComponentId++,
          settlement_id: id,
          name: nameMap[key] || key,
          type: 'deduction',
          amount: Math.round(amount),
          is_taxable: false,
          description: `${nameMap[key] || key} deduction`,
          created_at: new Date(),
        });
      });

      totalDeductions += Math.round(totalStandardDeductions);
    }

    await db('settlement_components').insert(components);

    const netAmount = totalEarnings - totalDeductions;
    await db('settlements')
      .where('id', id)
      .update({
        total_earnings: totalEarnings,
        total_deductions: totalDeductions,
        net_amount: netAmount,
        status: 'processing',
        updated_at: new Date(),
      });

    res.json({
      message: 'Settlement calculated successfully',
      components,
      totalEarnings,
      totalDeductions,
      netAmount,
      status: 'processing',
    });
  } catch (error) {
    console.error('Error calculating settlement:', error);
    res.status(500).json({ error: 'Failed to calculate settlement' });
  }
};

const approveSettlement = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    const { paymentMode, paymentReference, settlementDate } = req.body;

    if (!paymentMode) {
      return res.status(400).json({ error: 'Payment mode is required' });
    }

    const settlement = await db('settlements')
      .where('id', id)
      .where('company_id', company_id)
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (!['processing', 'calculated'].includes(String(settlement.status))) {
      return res.status(400).json({ error: 'Settlement must be calculated before approval' });
    }

    await db('settlements')
      .where('id', id)
      .update({
        status: 'completed',
        payment_mode: paymentMode,
        payment_reference: paymentReference || null,
        settlement_date: settlementDate || new Date(),
        updated_at: new Date(),
      });

    await syncFinalSettlementChecklist(company_id, settlement.employee_id);

    const updatedSettlement = await db('settlements').where('id', id).first();
    const employee = await db('employees').where('id', settlement.employee_id).first();

    try {
      await sendEmail({
        to: employee?.email,
        subject: 'F&F Settlement Completed',
        template: 'settlement-completed',
        data: {
          employeeName: buildEmployeeName(employee),
          netAmount: settlement.net_amount,
          paymentMode,
          settlementDate: settlementDate || new Date(),
        },
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

    await db('settlements')
      .where('id', id)
      .update({
        status: 'rejected',
        remarks: rejectionReason || settlement.remarks,
        updated_at: new Date(),
      });

    const updatedSettlement = await db('settlements').where('id', id).first();
    res.json(updatedSettlement);
  } catch (error) {
    console.error('Error rejecting settlement:', error);
    res.status(500).json({ error: 'Failed to reject settlement' });
  }
};

const getEmployeesForSettlement = async (req, res) => {
  try {
    const { company_id } = req.user;
    const { search } = req.query;

    let query = db('resignations')
      .select([
        'employees.id',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id',
        'employees.email',
        'employees.status',
        'departments.name as department',
        'designations.name as designation',
        'resignations.resignation_date',
        'resignations.last_working_day',
      ])
      .join('employees', 'resignations.employee_id', 'employees.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .leftJoin('settlements', function () {
        this.on('settlements.employee_id', '=', 'employees.id')
          .andOn('settlements.company_id', '=', 'employees.company_id')
          .andOn(db.raw("settlements.status <> 'rejected'"));
      })
      .where('resignations.company_id', company_id)
      .where('resignations.approval_status', 'approved')
      .whereNull('settlements.id');

    if (search) {
      const searchPattern = `%${escapeLike(search)}%`;
      query = query.where(function () {
        this.where('employees.first_name', 'like', searchPattern)
          .orWhere('employees.last_name', 'like', searchPattern)
          .orWhere('employees.employee_id', 'like', searchPattern);
      });
    }

    let employees = await query.orderBy('employees.first_name', 'asc');

    if (!employees.length) {
      let fallbackQuery = db('employees')
        .select([
          'employees.id',
          'employees.first_name',
          'employees.last_name',
          'employees.employee_id',
          'employees.email',
          'employees.status',
          'departments.name as department',
          'designations.name as designation',
          db.raw('NULL as resignation_date'),
          db.raw('NULL as last_working_day'),
        ])
        .leftJoin('departments', 'employees.department_id', 'departments.id')
        .leftJoin('designations', 'employees.designation_id', 'designations.id')
        .leftJoin('settlements', function () {
          this.on('settlements.employee_id', '=', 'employees.id')
            .andOn('settlements.company_id', '=', 'employees.company_id')
            .andOn(db.raw("settlements.status <> 'rejected'"));
        })
        .where('employees.company_id', company_id)
        .whereNull('settlements.id');

      if (search) {
        const searchPattern = `%${escapeLike(search)}%`;
        fallbackQuery = fallbackQuery.where(function () {
          this.where('employees.first_name', 'like', searchPattern)
            .orWhere('employees.last_name', 'like', searchPattern)
            .orWhere('employees.employee_id', 'like', searchPattern);
        });
      }

      employees = await fallbackQuery.orderBy('employees.first_name', 'asc');
    }

    res.json(
      employees.map((employee) => ({
        ...employee,
        name: buildEmployeeName(employee),
      }))
    );
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
};

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
        'departments.name as department',
        'designations.name as designation',
      ])
      .leftJoin('employees', 'settlements.employee_id', 'employees.id')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('settlements.id', id)
      .where('settlements.company_id', company_id)
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    const components = await db('settlement_components')
      .where('settlement_id', id)
      .orderBy([{ column: 'type', order: 'asc' }, { column: 'created_at', order: 'asc' }]);

    res.json({
      settlement: {
        ...settlement,
        employee_name: buildEmployeeName(settlement),
      },
      components,
      reportGeneratedAt: new Date(),
    });
  } catch (error) {
    console.error('Error generating settlement report:', error);
    res.status(500).json({ error: 'Failed to generate settlement report' });
  }
};

const sendSettlementEmail = async (req, res) => {
  try {
    const { company_id } = req.user;
    const { settlementId, employeeEmail, employeeName, netAmount, status } = req.body;

    const settlement = await db('settlements')
      .where('id', settlementId)
      .where('company_id', company_id)
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    await sendEmail({
      to: employeeEmail,
      subject: `F&F Settlement Update - ${String(status || settlement.status).charAt(0).toUpperCase() + String(status || settlement.status).slice(1)}`,
      template: 'settlement-update',
      data: {
        employeeName,
        netAmount,
        status: status || settlement.status,
        settlementDate: settlement.settlement_date,
        lastWorkingDay: settlement.last_working_day,
      },
    });

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
  sendSettlementEmail,
};
