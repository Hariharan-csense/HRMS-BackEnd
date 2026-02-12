// controllers/ticketController.js
const knex = require('../db/db');
const {
  sendTicketCreatedMail,
  sendTicketStatusUpdateMail
} = require('../utils/sendTicketMail');

// @desc    Create new ticket
// @route   POST /api/tickets
// @access  Admin only
// const createTicket = async (req, res) => {
//   try {
//     const { title, description, priority, category, assigned_to } = req.body;
//     const createdBy = req.user.id;

//     // Validate required fields
//     if (!title || !description) {
//       return res.status(400).json({
//         success: false,
//         message: 'Title and description are required'
//       });
//     }

//     // Validate priority
//     const validPriorities = ['low', 'medium', 'high', 'urgent'];
//     if (priority && !validPriorities.includes(priority)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid priority. Must be: low, medium, high, or urgent'
//       });
//     }

//     // Validate category
//     const validCategories = ['technical', 'hr', 'finance', 'operations', 'general'];
//     if (category && !validCategories.includes(category)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid category. Must be: technical, hr, finance, operations, or general'
//       });
//     }

//     // Generate ticket number
//     const ticketNumber = await generateTicketNumber();

//     // Insert ticket into database - set assigned_to to NULL to avoid foreign key issues
//     const [newTicket] = await knex('tickets')
//       .insert({
//         ticket_number: ticketNumber,
//         title,
//         description,
//         priority: priority || 'medium',
//         category: category || 'general',
//         status: 'open',
//         assigned_to: null, // Always set to NULL for now
//         created_by: createdBy,
//         company_id: req.user.company_id || null, // Add company_id from user
//         created_at: new Date()
//       })
//       .returning(['id', 'ticket_number', 'title', 'priority', 'category', 'status', 'created_at']);

//     // Get creator details
//     const creator = await knex('users')
//       .where('id', createdBy)
//       .select('name', 'email')
//       .first();

//     // Get assigned user details if assigned
//     let assignedUser = null;
//     if (assigned_to) {
//       assignedUser = await knex('users')
//         .where('id', assigned_to)
//         .select('name', 'email')
//         .first();
//     }

//     // Format response
//     const formattedTicket = {
//       id: newTicket.id,
//       ticketNumber: newTicket.ticket_number,
//       title: newTicket.title,
//       description,
//       priority: newTicket.priority,
//       category: newTicket.category,
//       status: newTicket.status,
//       remarks: null, // New tickets start with no remarks
//       assignedTo: assignedUser,
//       createdBy: creator,
//       createdAt: newTicket.created_at
//     };

//     res.status(201).json({
//       success: true,
//       message: 'Ticket created successfully',
//       data: formattedTicket
//     });
//   } catch (error) {
//     console.error('Error creating ticket:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create ticket',
//       error: error.message
//     });
//   }
// };



const createTicket = async (req, res) => {
  try {
    const { title, description, priority, category } = req.body;
    const createdBy = req.user.id;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ success:false,message:'Invalid priority'});
    }

    const validCategories = ['technical','hr','finance','operations','general'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ success:false,message:'Invalid category'});
    }

    const ticketNumber = await generateTicketNumber();

    const [newTicket] = await knex('tickets')
      .insert({
        ticket_number: ticketNumber,
        title,
        description,
        priority: priority || 'medium',
        category: category || 'general',
        status: 'open',
        assigned_to: null,
        created_by: createdBy,
        company_id: req.user.company_id || null,
        created_at: new Date()
      })
      .returning(['id','ticket_number','title','priority','category','status','created_at']);

    const creator = await knex('users')
      .where('id', createdBy)
      .select('name','email')
      .first();

    const formattedTicket = {
      id: newTicket.id,
      ticketNumber: newTicket.ticket_number,
      title: newTicket.title,
      description,
      priority: newTicket.priority,
      category: newTicket.category,
      status: newTicket.status,
      remarks:null,
      createdBy: creator,
      createdAt: newTicket.created_at
    };

    // 🔔 SUPERADMIN MAIL
    const superAdmins = await knex('users')
      .where('role','superadmin')
      .select('email');

    const superAdminEmails = superAdmins.map(u=>u.email);

    if(superAdminEmails.length){
      await sendTicketCreatedMail(
        superAdminEmails,
        formattedTicket,
        creator
      );
    }

    res.status(201).json({
      success:true,
      message:'Ticket created successfully',
      data:formattedTicket
    });

  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ success:false,message:'Failed to create ticket',error:error.message});
  }
};


// @desc    Get all tickets
// @route   GET /api/tickets
// @access  Admin only
// const getTickets = async (req, res) => {
//   try {
//     const { status, priority, category, page = 1, limit = 10 } = req.query;
//     const offset = (page - 1) * limit;

//     let query = knex('tickets')
//       .select([
//         'tickets.id',
//         'tickets.ticket_number',
//         'tickets.title',
//         'tickets.description',
//         'tickets.remarks',
//         'tickets.priority',
//         'tickets.category',
//         'tickets.status',
//         'tickets.assigned_to',
//         'tickets.created_by',
//         'tickets.company_id',
//         'tickets.created_at',
//         'tickets.updated_at',
//         'creator.name as creator_name',
//         'creator.email as creator_email',
//         'assigned.name as assigned_name',
//         'assigned.email as assigned_email',
//         'companies.company_name',
//         'companies.company_id as company_identifier'
//       ])
//       .leftJoin('users as creator', 'tickets.created_by', 'creator.id')
//       .leftJoin('users as assigned', 'tickets.assigned_to', 'assigned.id')
//       .leftJoin('companies', 'tickets.company_id', 'companies.id')
//       .orderBy('tickets.created_at', 'desc');

//     // Apply filters
//     if (status) {
//       query = query.where('tickets.status', status);
//     }
//     if (priority) {
//       query = query.where('tickets.priority', priority);
//     }
//     if (category) {
//       query = query.where('tickets.category', category);
//     }

//     // Get total count for pagination
//     const countQuery = knex('tickets').count('* as total');
//     if (status) countQuery.where('status', status);
//     if (priority) countQuery.where('priority', priority);
//     if (category) countQuery.where('category', category);
//     const [{ total }] = await countQuery;

//     // Get paginated results
//     const tickets = await query.limit(limit).offset(offset);

//     // Format tickets
//     const formattedTickets = tickets.map(ticket => ({
//       id: ticket.id,
//       ticketNumber: ticket.ticket_number,
//       title: ticket.title,
//       description: ticket.description,
//       remarks: ticket.remarks,
//       priority: ticket.priority,
//       category: ticket.category,
//       status: ticket.status,
//       assignedTo: ticket.assigned_to ? {
//         name: ticket.assigned_name,
//         email: ticket.assigned_email
//       } : null,
//       createdBy: {
//         name: ticket.creator_name,
//         email: ticket.creator_email
//       },
//       organization: ticket.company_id ? {
//         id: ticket.company_id,
//         name: ticket.company_name,
//         companyId: ticket.company_identifier
//       } : null,
//       createdAt: ticket.created_at,
//       updatedAt: ticket.updated_at
//     }));

//     res.status(200).json({
//       success: true,
//       data: formattedTickets,
//       pagination: {
//         page: parseInt(page),
//         limit: parseInt(limit),
//         total: parseInt(total),
//         pages: Math.ceil(total / limit)
//       }
//     });
//   } catch (error) {
//     console.error('Error fetching tickets:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch tickets',
//       error: error.message
//     });
//   }
// };
const getTickets = async (req, res) => {
  try {

    const { status, priority, category, page = 1, limit = 10 } = req.query;
    const companyId = req.user.company_id;

    const offset = (page - 1) * limit;

    let query = knex('tickets')
      .select([
        'tickets.id',
        'tickets.ticket_number',
        'tickets.title',
        'tickets.description',
        'tickets.remarks',
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
      .where('tickets.company_id', companyId)
      .orderBy('tickets.created_at', 'desc');

    /* -------- FILTERS -------- */
    if (status) {
      query.where('tickets.status', status);
    }
    if (priority) {
      query.where('tickets.priority', priority);
    }
    if (category) {
      query.where('tickets.category', category);
    }

    /* -------- COUNT QUERY -------- */
    let countQuery = knex('tickets')
      .where('company_id', companyId)
      .count('* as total');

    if (status) countQuery.where('status', status);
    if (priority) countQuery.where('priority', priority);
    if (category) countQuery.where('category', category);

    const [{ total }] = await countQuery;

    /* -------- FETCH DATA -------- */
    const tickets = await query.limit(limit).offset(offset);

    /* -------- FORMAT RESPONSE -------- */
    const formattedTickets = tickets.map(ticket => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      description: ticket.description,
      remarks: ticket.remarks,
      priority: ticket.priority,
      category: ticket.category,
      status: ticket.status,
      assignedTo: ticket.assigned_to
        ? {
            name: ticket.assigned_name,
            email: ticket.assigned_email
          }
        : null,
      createdBy: {
        name: ticket.creator_name,
        email: ticket.creator_email
      },
      organization: {
        id: ticket.company_id,
        name: ticket.company_name,
        companyId: ticket.company_identifier
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
    console.error('Error fetching tickets:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
      error: error.message
    });
  }
};




// @desc    Get single ticket
// @route   GET /api/tickets/:id
// @access  Admin only
const getTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await knex('tickets')
      .select([
        'tickets.id',
        'tickets.ticket_number',
        'tickets.title',
        'tickets.description',
        'tickets.remarks',
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
      .where('tickets.id', id)
      .first();

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Format ticket
    const formattedTicket = {
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      description: ticket.description,
      remarks: ticket.remarks,
      priority: ticket.priority,
      category: ticket.category,
      status: ticket.status,
      assignedTo: ticket.assigned_to ? {
        name: ticket.assigned_name,
        email: ticket.assigned_email
      } : null,
      createdBy: {
        name: ticket.creator_name,
        email: ticket.creator_email
      },
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at
    };

    res.status(200).json({
      success: true,
      data: formattedTicket
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket',
      error: error.message
    });
  }
};

// @desc    Update ticket
// @route   PUT /api/tickets/:id
// @access  Admin only
// const updateTicket = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { title, description, remarks, category, status, assigned_to } = req.body;

//     // Check if ticket exists
//     const existingTicket = await knex('tickets').where('id', id).first();
//     if (!existingTicket) {
//       return res.status(404).json({
//         success: false,
//         message: 'Ticket not found'
//       });
//     }

//     // Validate status
//     const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
//     if (status && !validStatuses.includes(status)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid status. Must be: open, in_progress, resolved, or closed'
//       });
//     }

//     // Validate category
//     const validCategories = ['technical', 'hr', 'finance', 'operations', 'general'];
//     if (category && !validCategories.includes(category)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid category. Must be: technical, hr, finance, operations, or general'
//       });
//     }

//     // Update ticket
//     const updateData = {
//       title: title || existingTicket.title,
//       description: description || existingTicket.description,
//       category: category || existingTicket.category,
//       status: status || existingTicket.status,
//       assigned_to: null, // Always set to NULL to avoid foreign key issues
//       updated_at: new Date()
//     };
    
//     // Only update remarks if explicitly provided in the request
//     if (req.body.hasOwnProperty('remarks')) {
//       updateData.remarks = remarks;
//     }
    
//     await knex('tickets')
//       .where('id', id)
//       .update(updateData);

//     // Get updated ticket details with user info
//     const ticket = await knex('tickets')
//       .select([
//         'tickets.id',
//         'tickets.ticket_number',
//         'tickets.title',
//         'tickets.description',
//         'tickets.remarks',
//         'tickets.priority',
//         'tickets.category',
//         'tickets.status',
//         'tickets.assigned_to',
//         'tickets.created_by',
//         'tickets.created_at',
//         'tickets.updated_at',
//         'creator.name as creator_name',
//         'creator.email as creator_email',
//         'assigned.name as assigned_name',
//         'assigned.email as assigned_email'
//       ])
//       .leftJoin('users as creator', 'tickets.created_by', 'creator.id')
//       .leftJoin('users as assigned', 'tickets.assigned_to', 'assigned.id')
//       .where('tickets.id', id)
//       .first();

//     // Format response
//     const formattedTicket = {
//       id: ticket.id,
//       ticketNumber: ticket.ticket_number,
//       title: ticket.title,
//       description: ticket.description,
//       remarks: ticket.remarks,
//       priority: ticket.priority,
//       category: ticket.category,
//       status: ticket.status,
//       assignedTo: ticket.assigned_to ? {
//         name: ticket.assigned_name,
//         email: ticket.assigned_email
//       } : null,
//       createdBy: {
//         name: ticket.creator_name,
//         email: ticket.creator_email
//       },
//       createdAt: ticket.created_at,
//       updatedAt: ticket.updated_at
//     };

//     res.status(200).json({
//       success: true,
//       message: 'Ticket updated successfully',
//       data: formattedTicket
//     });
//   } catch (error) {
//     console.error('Error updating ticket:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update ticket',
//       error: error.message
//     });
//   }
// };

const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, remarks, category, status } = req.body;

    const existingTicket = await knex('tickets').where('id', id).first();
    if (!existingTicket) {
      return res.status(404).json({ success:false,message:'Ticket not found'});
    }

    const validStatuses = ['open','in_progress','resolved','closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success:false,message:'Invalid status'});
    }

    const updateData = {
      title: title || existingTicket.title,
      description: description || existingTicket.description,
      category: category || existingTicket.category,
      status: status || existingTicket.status,
      assigned_to:null,
      updated_at:new Date()
    };

    if(req.body.hasOwnProperty('remarks')){
      updateData.remarks = remarks;
    }

    await knex('tickets').where('id', id).update(updateData);

    const ticket = await knex('tickets')
      .leftJoin('users as creator','tickets.created_by','creator.id')
      .select(
        'tickets.*',
        'creator.email as creator_email',
        'creator.name as creator_name'
      )
      .where('tickets.id', id)
      .first();

    const formattedTicket = {
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      status: ticket.status,
      remarks: ticket.remarks
    };

    // 🔔 STATUS UPDATE MAIL
    if(status && status !== existingTicket.status){
      await sendTicketStatusUpdateMail(
        ticket.creator_email,
        formattedTicket
      );
    }

    res.status(200).json({
      success:true,
      message:'Ticket updated successfully'
    });

  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ success:false,message:'Failed to update ticket',error:error.message});
  }
};

async function generateTicketNumber() {
  const prefix='TKT';
  const year=new Date().getFullYear();

  const latestTicket=await knex('tickets')
    .where('ticket_number','like',`${prefix}${year}%`)
    .orderBy('ticket_number','desc')
    .first();

  let sequence=1;
  if(latestTicket){
    const seq=latestTicket.ticket_number.replace(`${prefix}${year}`,'');
    sequence=parseInt(seq)+1;
  }

  return `${prefix}${year}${sequence.toString().padStart(4,'0')}`;
}


// @desc    Delete ticket
// @route   DELETE /api/tickets/:id
// @access  Admin only
const deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ticket exists
    const existingTicket = await knex('tickets').where('id', id).first();
    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Delete ticket
    await knex('tickets').where('id', id).del();

    res.status(200).json({
      success: true,
      message: 'Ticket deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete ticket',
      error: error.message
    });
  }
};

// @desc    Get users for assignment
// @route   GET /api/tickets/users
// @access  Admin only
const getUsersForAssignment = async (req, res) => {
  try {
    // Return hardcoded procease.co user only
    const users = [
      {
        id: "procease.co",
        name: "procease.co",
        email: "procease.co",
        role: "admin"
      }
    ];

    res.status(200).json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

// Helper function to generate ticket number
async function generateTicketNumber() {
  const prefix = 'TKT';
  const year = new Date().getFullYear();
  
  // Get the latest ticket number for this year
  const latestTicket = await knex('tickets')
    .where('ticket_number', 'like', `${prefix}${year}%`)
    .orderBy('ticket_number', 'desc')
    .first();

  let sequence = 1;
  if (latestTicket) {
    // Extract sequence number from latest ticket number
    const sequenceStr = latestTicket.ticket_number.replace(`${prefix}${year}`, '');
    sequence = parseInt(sequenceStr) + 1;
  }

  // Format: TKT20240001 (4-digit sequence)
  return `${prefix}${year}${sequence.toString().padStart(4, '0')}`;
}

module.exports = {
  createTicket,
  getTickets,
  getTicket,
  updateTicket,
  deleteTicket,
  getUsersForAssignment
};
