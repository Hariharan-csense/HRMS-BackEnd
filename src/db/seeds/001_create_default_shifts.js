exports.seed = function(knex) {
  return knex('shifts').del()
    .then(function () {
      return knex('shifts').insert([
        {
          id: 1,
          name: 'Morning',
          start_time: '06:00:00',
          end_time: '14:00:00',
          description: 'Morning shift (6 AM - 2 PM)',
          status: 'Active',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 2,
          name: 'Afternoon',
          start_time: '14:00:00',
          end_time: '22:00:00',
          description: 'Afternoon shift (2 PM - 10 PM)',
          status: 'Active',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 3,
          name: 'Night',
          start_time: '22:00:00',
          end_time: '06:00:00',
          description: 'Night shift (10 PM - 6 AM)',
          status: 'Active',
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    });
};
