require("dotenv").config();

module.exports = {
  development: {
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // Attendance timestamps are stored in UTC. Keep MySQL date parsing
      // independent of the hosting panel/server timezone.
      timezone: "Z",
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    },
    migrations: {
      directory: "./src/db/migrations",
    },
    seeds: {
      directory: "./src/db/seeds",
    },
  },
};
