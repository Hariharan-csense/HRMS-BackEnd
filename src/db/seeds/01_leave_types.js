exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('leave_types').del();

  // Insert default leave types
  await knex('leave_types').insert([
    {
      leave_type_id: 'LT001',
      name: 'Casual Leave',
      is_paid: true,
      annual_limit: 12,
      carry_forward: 5,
      encashable: true,
      description: 'Casual leave for personal work',
      status: 'active'
    },
    {
      leave_type_id: 'LT002',
      name: 'Sick Leave',
      is_paid: true,
      annual_limit: 10,
      carry_forward: 0,
      encashable: false,
      description: 'Medical leave',
      status: 'active'
    },
    {
      leave_type_id: 'LT003',
      name: 'Annual Leave',
      is_paid: true,
      annual_limit: 20,
      carry_forward: 10,
      encashable: true,
      description: 'Vacation leave',
      status: 'active'
    },
    {
      leave_type_id: 'LT004',
      name: 'Unpaid Leave',
      is_paid: false,
      annual_limit: 0,
      carry_forward: 0,
      encashable: false,
      description: 'Leave without pay',
      status: 'active'
    },
    {
      leave_type_id: 'LT005',
      name: 'Maternity Leave',
      is_paid: true,
      annual_limit: 180,
      carry_forward: 0,
      encashable: false,
      description: 'Maternity leave for female employees',
      status: 'active'
    }
  ]);
};