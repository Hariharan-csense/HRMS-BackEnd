const knex = require('../db/db');

// Get all onboarding employees for a company
const getOnboardingEmployees = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { status, search } = req.query;

    let query = knex('onboarding_employees')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc');

    // Apply filters
    if (status && status !== 'all') {
      query = query.where('status', status);
    }

    if (search) {
      query = query.where(function() {
        this.where('name', 'ilike', `%${search}%`)
            .orWhere('email', 'ilike', `%${search}%`)
            .orWhere('position', 'ilike', `%${search}%`);
      });
    }

    const employees = await query;

    // Get tasks and documents for each employee
    for (let employee of employees) {
      const tasks = await knex('onboarding_tasks')
        .where('employee_id', employee.id)
        .orderBy('created_at', 'asc');

      const documents = await knex('onboarding_documents')
        .where('employee_id', employee.id)
        .orderBy('required', 'desc')
        .orderBy('name', 'asc');

      employee.tasks = tasks;
      employee.documents = documents;
    }

    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('Error fetching onboarding employees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch onboarding employees'
    });
  }
};

// Get onboarding employee by ID with tasks and documents
const getOnboardingEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const employee = await knex('onboarding_employees')
      .where({
        id,
        company_id: companyId
      })
      .first();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding employee not found'
      });
    }

    // Get tasks
    const tasks = await knex('onboarding_tasks')
      .where('employee_id', employee.id)
      .orderBy('created_at', 'asc');

    // Get documents
    const documents = await knex('onboarding_documents')
      .where('employee_id', employee.id)
      .orderBy('required', 'desc')
      .orderBy('name', 'asc');

    res.json({
      success: true,
      data: {
        ...employee,
        tasks,
        documents
      }
    });
  } catch (error) {
    console.error('Error fetching onboarding employee:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch onboarding employee'
    });
  }
};

// Create new onboarding employee
// const createOnboardingEmployee = async (req, res) => {
//   try {
//     const companyId = req.user.company_id;
//     const {
//       name,
//       email,
//       phone,
//       position,
//       department,
//       start_date,
//       location,
//       manager,
//       notes
//     } = req.body;

//     // Check if employee with email already exists
//     const existingEmployee = await knex('onboarding_employees')
//       .where({
//         email,
//         company_id: companyId
//       })
//       .first();

//     if (existingEmployee) {
//       return res.status(400).json({
//         success: false,
//         message: 'Employee with this email already exists in onboarding'
//       });
//     }

//     const insertResult = await knex('onboarding_employees').insert({
//       company_id: companyId,
//       name,
//       email,
//       phone,
//       position,
//       department,
//       start_date,
//       location,
//       manager,
//       notes,
//       created_by: req.user.id
//     });

//     // Debug: Log the raw insert result
//     console.log('Raw insert result:', insertResult);

//     // Handle different result types from Knex
//     let employee = null;
//     let employeeId = null;

//     if (Array.isArray(insertResult)) {
//       console.log('Insert returned array with length:', insertResult.length);
//       if (insertResult.length > 0) {
//         employee = insertResult[0];
//         employeeId = employee.id;
//         console.log('Employee ID from array[0]:', employeeId);
//         console.log('Employee object structure:', Object.keys(employee));
//       }
//     } else if (insertResult && typeof insertResult === 'object') {
//       console.log('Insert returned object');
//       employee = insertResult;
//       employeeId = employee.id;
//       console.log('Employee ID from object:', employeeId);
//       console.log('Employee object keys:', Object.keys(employee));
//     } else {
//       console.error('Insert returned unexpected type:', typeof insertResult);
//     }

//     console.log('Final employee ID being used:', employeeId);

//     // Check if employee was created successfully
//     if (!employee || !employeeId) {
//       console.error('Employee creation failed - no employee or ID extracted');
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to create onboarding employee - could not retrieve employee ID'
//       });
//     }

//     // Create default tasks for employee
//     const defaultTasks = [
//       {
//         title: 'Submit ID Proof',
//         description: 'Upload Aadhar card or Passport',
//         category: 'documentation',
//         priority: 'high'
//       },
//       {
//         title: 'PAN Card Submission',
//         description: 'Upload PAN card for tax purposes',
//         category: 'documentation',
//         priority: 'high'
//       },
//       {
//         title: 'Bank Account Details',
//         description: 'Provide bank account details for salary',
//         category: 'documentation',
//         priority: 'high'
//       },
//       {
//         title: 'Laptop Setup',
//         description: 'Configure development environment',
//         category: 'it-setup',
//         priority: 'high'
//       },
//       {
//         title: 'Email Account Setup',
//         description: 'Create company email account',
//         category: 'it-setup',
//         priority: 'medium'
//       },
//       {
//         title: 'HR Orientation',
//         description: 'Attend company policies session',
//         category: 'orientation',
//         priority: 'medium'
//       },
//       {
//         title: 'Team Introduction',
//         description: 'Meet with team members',
//         category: 'orientation',
//         priority: 'medium'
//       }
//     ];

//     // Create default tasks after employee is created - with error handling
//     if (employee && employee.id) {
//       console.log('Creating default tasks for employee:', employee.id);
      
//       for (const task of defaultTasks) {
//         try {
//           await knex('onboarding_tasks').insert({
//             employee_id: employee.id,
//             ...task,
//             created_by: req.user.id
//           });
//           console.log('Successfully created task:', task.title);
//         } catch (taskError) {
//           console.error('Error creating default task:', taskError);
//           // Continue with other tasks even if one fails
//         }
//       }
//     } else {
//       console.error('Employee creation failed or employee ID is undefined');
//     }

//     // Create default documents
//     const defaultDocuments = [
//       { name: 'Aadhar Card', type: 'ID Proof', required: true },
//       { name: 'PAN Card', type: 'Tax Document', required: true },
//       { name: 'Bank Account Details', type: 'Banking', required: true },
//       { name: 'Previous Employment Letter', type: 'Experience', required: false },
//       { name: 'Educational Certificates', type: 'Education', required: false }
//     ];

//     for (const doc of defaultDocuments) {
//       await knex('onboarding_documents').insert({
//         employee_id: employee.id,
//         ...doc,
//         created_by: req.user.id
//       });
//     }

//     res.status(201).json({
//       success: true,
//       data: employee,
//       message: 'Onboarding employee created successfully'
//     });
//   } catch (error) {
//     console.error('Error creating onboarding employee:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create onboarding employee'
//     });
//   }
// };


const createOnboardingEmployee = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const {
      name,
      email,
      phone,
      position,
      department,
      // Accept both start_date and startDate for backward compatibility
      start_date: rawStartDate1,
      startDate: rawStartDate2,
      location,
      manager,
      notes,
      assignedHR
    } = req.body;

    // Use either start_date or startDate, with start_date taking precedence
    const rawStartDate = rawStartDate1 || rawStartDate2;

    // Validate that start_date is provided
    if (!rawStartDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date is required'
      });
    }

    // Validate and format the date
    let formattedDate;
    try {
      // Check if the date is in YYYY-MM-DD format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(rawStartDate)) {
        throw new Error('Invalid date format');
      }
      
      // Parse the date to validate it
      const date = new Date(rawStartDate);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      
      // Format as YYYY-MM-DD for MySQL
      formattedDate = rawStartDate;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format (e.g., 2026-03-12)'
      });
    }

    // Check duplicate employee
    const existingEmployee = await knex('onboarding_employees')
      .where({
        email,
        company_id: companyId
      })
      .first();

    if (existingEmployee) {
      return res.status(400).json({
        success: false,
        message: 'Employee with this email already exists in onboarding'
      });
    }

    // Default tasks
    const defaultTasks = [
      { title: 'Submit ID Proof', description: 'Upload Aadhar card or Passport', category: 'documentation', priority: 'high' },
      { title: 'PAN Card Submission', description: 'Upload PAN card for tax purposes', category: 'documentation', priority: 'high' },
      { title: 'Bank Account Details', description: 'Provide bank account details for salary', category: 'documentation', priority: 'high' },
      { title: 'Laptop Setup', description: 'Configure development environment', category: 'it-setup', priority: 'high' },
      { title: 'Email Account Setup', description: 'Create company email account', category: 'it-setup', priority: 'medium' },
      { title: 'HR Orientation', description: 'Attend company policies session', category: 'orientation', priority: 'medium' },
      { title: 'Team Introduction', description: 'Meet with team members', category: 'orientation', priority: 'medium' }
    ];

    // Default documents
    const defaultDocuments = [
      { name: 'Aadhar Card', type: 'ID Proof', required: true },
      { name: 'PAN Card', type: 'Tax Document', required: true },
      { name: 'Bank Account Details', type: 'Banking', required: true },
      { name: 'Previous Employment Letter', type: 'Experience', required: false },
      { name: 'Educational Certificates', type: 'Education', required: false }
    ];

    // Transaction for full safety
    const result = await knex.transaction(async trx => {

      // Insert employee
      const insertResult = await trx('onboarding_employees').insert({
        company_id: companyId,
        name,
        email,  
        phone,
        position,
        department,
        start_date: formattedDate,
        location,
        manager,
        notes,
        created_by: req.user.id
      });

      // Universal ID extraction
      const employeeId = Array.isArray(insertResult)
        ? insertResult[0]
        : insertResult;

      if (!employeeId) {
        throw new Error('Failed to retrieve employee ID after insert');
      }

      // Bulk insert tasks
      const tasksToInsert = defaultTasks.map(task => ({
        employee_id: employeeId,
        ...task,
        created_by: req.user.id
      }));

      await trx('onboarding_tasks').insert(tasksToInsert);

      // Bulk insert documents
      const docsToInsert = defaultDocuments.map(doc => ({
        employee_id: employeeId,
        ...doc,
        created_by: req.user.id
      }));

      await trx('onboarding_documents').insert(docsToInsert);

      // Fetch created employee
      const employee = await trx('onboarding_employees')
        .where({ id: employeeId })
        .first();

      return employee;
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Onboarding employee created successfully'
    });

  } catch (error) {
    console.error('Error creating onboarding employee:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to create onboarding employee'
    });
  }
};


// Update onboarding employee
const updateOnboardingEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const updateData = { ...req.body, updated_by: req.user.id };

    const [updatedEmployee] = await knex('onboarding_employees')
      .where({ id, company_id: companyId })
      .update(updateData)
      .returning('*');

    if (!updatedEmployee) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding employee not found'
      });
    }

    res.json({
      success: true,
      data: updatedEmployee,
      message: 'Onboarding employee updated successfully'
    });
  } catch (error) {
    console.error('Error updating onboarding employee:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update onboarding employee'
    });
  }
};

// Delete onboarding employee
const deleteOnboardingEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const deleted = await knex('onboarding_employees')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding employee not found'
      });
    }

    res.json({
      success: true,
      message: 'Onboarding employee deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting onboarding employee:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete onboarding employee'
    });
  }
};

// Create task for onboarding employee
const createOnboardingTask = async (req, res) => {
  try {
    const { id } = req.params; // employee_id
    const companyId = req.user.company_id;
    const {
      title,
      description,
      category,
      dueDate, // Changed from due_date
      assignee, // Changed from assigned_to
      priority
    } = req.body;

    // Verify employee exists
    const employee = await knex('onboarding_employees')
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding employee not found'
      });
    }

    // Log the incoming data for debugging
    console.log('Creating task with data:', {
      title,
      description,
      category,
      dueDate,
      assignee,
      priority
    });

    const [task] = await knex('onboarding_tasks').insert({
      employee_id: id,
      title,
      description,
      category: category || 'general',
      due_date: dueDate, // Map frontend dueDate to database due_date
      assigned_to: assignee, // Map frontend assignee to database assigned_to
      priority: priority || 'medium',
      created_by: req.user.id
    }).returning('*');

    res.status(201).json({
      success: true,
      data: task,
      message: 'Task created successfully'
    });
  } catch (error) {
    console.error('Error creating onboarding task:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create onboarding task'
    });
  }
};

// Toggle task completion
const toggleTaskCompletion = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { completed } = req.body;

    // First update the task
    const updateResult = await knex('onboarding_tasks')
      .where('id', taskId)
      .update({
        completed,
        completed_date: completed ? new Date() : null
      });

    if (!updateResult) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Then fetch the updated task
    const updatedTask = await knex('onboarding_tasks')
      .where('id', taskId)
      .first();

    if (!updatedTask) {
      return res.status(404).json({
        success: false,
        message: 'Task not found after update'
      });
    }

    // Recalculate employee progress
    const tasks = await knex('onboarding_tasks')
      .where('employee_id', updatedTask.employee_id);
    
    const completedTasks = tasks.filter(task => task.completed).length;
    const progress = Math.round((completedTasks / tasks.length) * 100);

    await knex('onboarding_employees')
      .where('id', updatedTask.employee_id)
      .update({ progress });

    // Update employee status based on progress
    let status = 'in-progress';
    if (progress === 100) {
      status = 'completed';
    } else if (progress === 0) {
      status = 'pending';
    }

    await knex('onboarding_employees')
      .where('id', updatedTask.employee_id)
      .update({ status });

    res.json({
      success: true,
      data: { ...updatedTask, employee_progress: progress },
      message: 'Task updated successfully'
    });
  } catch (error) {
    console.error('Error toggling task completion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task'
    });
  }
};

// Create document for onboarding employee
const createOnboardingDocument = async (req, res) => {
  try {
    const { id } = req.params; // employee_id
    const companyId = req.user.company_id;
    const {
      name,
      type,
      required
    } = req.body;

    // Verify employee exists
    const employee = await knex('onboarding_employees')
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding employee not found'
      });
    }

    const [document] = await knex('onboarding_documents').insert({
      employee_id: id,
      name,
      type,
      required: required || false,
      created_by: req.user.id
    }).returning('*');

    res.status(201).json({
      success: true,
      data: document,
      message: 'Document created successfully'
    });
  } catch (error) {
    console.error('Error creating onboarding document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create onboarding document'
    });
  }
};

// Update document upload status
const updateDocumentUpload = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { uploaded, file_url } = req.body;

    const [updatedDocument] = await knex('onboarding_documents')
      .where('id', documentId)
      .update({
        uploaded,
        upload_date: uploaded ? new Date() : null,
        file_url
      })
      .returning('*');

    if (!updatedDocument) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    res.json({
      success: true,
      data: updatedDocument,
      message: 'Document updated successfully'
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update document'
    });
  }
};

// Get onboarding statistics
const getOnboardingStats = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const stats = await knex('onboarding_employees')
      .where('company_id', companyId)
      .select(
        knex.raw('COUNT(*) as total'),
        knex.raw('COUNT(CASE WHEN status = \'pending\' THEN 1 END) as pending'),
        knex.raw('COUNT(CASE WHEN status = \'in-progress\' THEN 1 END) as in_progress'),
        knex.raw('COUNT(CASE WHEN status = \'completed\' THEN 1 END) as completed'),
        knex.raw('COUNT(CASE WHEN status = \'delayed\' THEN 1 END) as `delayed`'),
        knex.raw('AVG(progress) as avg_progress')
      )
      .first();

    // Get upcoming onboardings (next 7 days)
    const upcoming = await knex('onboarding_employees')
      .where('company_id', companyId)
      .where('start_date', '>=', knex.raw('CURRENT_DATE'))
      .where('start_date', '<=', knex.raw('DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY)'))
      .count('id as count')
      .first();

    stats.upcoming = parseInt(upcoming.count);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching onboarding stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch onboarding statistics'
    });
  }
};

module.exports = {
  getOnboardingEmployees,
  getOnboardingEmployeeById,
  createOnboardingEmployee,
  updateOnboardingEmployee,
  deleteOnboardingEmployee,
  createOnboardingTask,
  toggleTaskCompletion,
  createOnboardingDocument,
  updateDocumentUpload,
  getOnboardingStats
};
