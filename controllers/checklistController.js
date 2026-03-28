const knex = require('../db/db');

const getAllChecklists = async (req, res) => {
  const company_id = req.user.company_id;

  try {
    const checklists = await knex('offboarding_checklists as o')
      .join('resignations as r', 'r.id', 'o.resignation_id')
      .select(
        'o.id',
        'o.resignation_id',
        'r.employee_id',
        'r.employee_name',
        'o.hr_clearance',
        'o.finance_clearance',
        'o.asset_return',
        'o.it_clearance',
        'o.final_settlement',
        'o.status',
        'o.completed_date'
      )
      .where('o.company_id', company_id)
      .orderBy('o.id', 'desc');

    res.json(checklists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * UPDATE checklist item
 * (company protected)
 */
const updateChecklistItem = async (req, res) => {
  const company_id = req.user.company_id;
  const { id } = req.params;
  const { field } = req.body;

  const allowedFields = [
    'hr_clearance',
    'finance_clearance',
    'asset_return',
    'it_clearance',
    'final_settlement'
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  try {
    const checklist = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    if (!checklist) {
      return res.status(404).json({
        error: 'Checklist not found for your company'
      });
    }

    // toggle field
    await knex('offboarding_checklists')
      .where({ id, company_id })
      .update({ [field]: !checklist[field] });

    const updated = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    const allDone = allowedFields.every(f => updated[f]);

    await knex('offboarding_checklists')
      .where({ id, company_id })
      .update({
        status: allDone ? 'completed' : 'in-progress',
        completed_date: allDone
          ? new Date().toISOString().slice(0, 10)
          : null
      });

    // If all checklist items are completed, update employee status to 'Inactive'
    if (allDone) {
      // Get the resignation to find the employee_id
      const resignation = await knex('resignations')
        .where({ id: updated.resignation_id })
        .first();

      console.log('Checklist completed, checking resignation:', resignation);
      console.log('Employee ID from resignation:', resignation?.employee_id);

      if (resignation && resignation.employee_id) {
        // First check if employee exists
        const employee = await knex('employees')
          .where({ id: resignation.employee_id, company_id })
          .first();

        console.log('Found employee:', employee);

        if (employee) {
          await knex('employees')
            .where({ id: resignation.employee_id, company_id })
            .update({ status: 'Inactive' });
          
          console.log(`Employee ${resignation.employee_id} marked as Inactive due to completed offboarding`);
        } else {
          console.log(`Employee ${resignation.employee_id} not found in company ${company_id}`);
        }
      } else {
        console.log('No employee_id found in resignation or resignation not found');
        // Try to find employee by name if employee_id is null
        if (resignation && resignation.employee_name) {
          const employeeByName = await knex('employees')
            .where({ 
              company_id,
              first_name: resignation.employee_name.split(' ')[0],
              last_name: resignation.employee_name.split(' ').slice(1).join(' ')
            })
            .first();

          if (employeeByName) {
            await knex('employees')
              .where({ id: employeeByName.id, company_id })
              .update({ status: 'Inactive' });
            
            console.log(`Employee ${employeeByName.id} found by name and marked as Inactive`);
          }
        }
      }
    }

    const final = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    res.json(final);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateEmployeeStatusForCompletedChecklist = async (req, res) => {
  const company_id = req.user.company_id;
  const { id } = req.params; // checklist id

  try {
    // Get the checklist
    const checklist = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    if (!checklist) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    // Check if all items are completed
    const allDone = checklist.hr_clearance && 
                   checklist.finance_clearance && 
                   checklist.asset_return && 
                   checklist.it_clearance && 
                   checklist.final_settlement;

    if (!allDone) {
      return res.status(400).json({ error: 'Checklist is not fully completed' });
    }

    // Get the resignation to find the employee_id
    const resignation = await knex('resignations')
      .where({ id: checklist.resignation_id })
      .first();

    console.log('Manual trigger - checking resignation:', resignation);

    let updatedEmployee = null;

    if (resignation && resignation.employee_id) {
      // Update by employee_id
      const employee = await knex('employees')
        .where({ id: resignation.employee_id, company_id })
        .first();

      if (employee) {
        await knex('employees')
          .where({ id: resignation.employee_id, company_id })
          .update({ status: 'Inactive' });
        
        updatedEmployee = await knex('employees')
          .where({ id: resignation.employee_id, company_id })
          .first();
        
        console.log(`Employee ${resignation.employee_id} manually marked as Inactive`);
      }
    } else if (resignation && resignation.employee_name) {
      // Try to find employee by name
      const employeeByName = await knex('employees')
        .where({ 
          company_id,
          first_name: resignation.employee_name.split(' ')[0],
          last_name: resignation.employee_name.split(' ').slice(1).join(' ')
        })
        .first();

      if (employeeByName) {
        await knex('employees')
          .where({ id: employeeByName.id, company_id })
          .update({ status: 'Inactive' });
        
        updatedEmployee = await knex('employees')
          .where({ id: employeeByName.id, company_id })
          .first();
        
        console.log(`Employee ${employeeByName.id} found by name and manually marked as Inactive`);
      }
    }

    if (!updatedEmployee) {
      return res.status(404).json({ error: 'Employee not found for this checklist' });
    }

    res.json({ 
      message: 'Employee status updated to Inactive',
      employee: updatedEmployee
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllChecklists,
  updateChecklistItem,
  updateEmployeeStatusForCompletedChecklist
};
