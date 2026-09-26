exports.up = async function (knex) {
  await knex.schema.createTable("essl_devices", (t) => {
    t.increments("id");
    t.integer("company_id").unsigned().notNullable().index();
    t.string("device_name", 191).notNullable();
    for (const field of ["device_model", "device_serial_number", "device_ip", "connection_type", "integration_type"]) t.string(field, 191).nullable();
    t.integer("device_port").unsigned().nullable();
    t.string("api_url", 2048).nullable();
    // Credentials intentionally omitted until a real adapter defines its needs.
    t.boolean("is_active").notNullable().defaultTo(true).index();
    t.dateTime("last_sync_at", { precision: 3 }).nullable();
    t.string("last_sync_status", 16).nullable();
    t.text("last_sync_error").nullable();
    t.timestamps(true, true);
    t.unique(["company_id", "device_serial_number"], "essl_device_serial_unique");
    t.index("device_serial_number");
    t.unique(["company_id", "id"], "essl_device_tenant_unique");
  });
  await knex.schema.createTable("essl_employee_mappings", (t) => {
    t.increments("id");
    t.integer("company_id").unsigned().notNullable().index();
    t.integer("device_id").unsigned().notNullable();
    t.integer("employee_id").unsigned().notNullable().index();
    t.specificType("essl_user_id", "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin").notNullable();
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.foreign(["company_id", "device_id"]).references(["company_id", "id"]).inTable("essl_devices");
    t.unique(["company_id", "device_id", "essl_user_id"], "essl_mapping_user_unique");
    t.unique(["company_id", "device_id", "employee_id"], "essl_mapping_employee_unique");
  });
  await knex.schema.createTable("essl_attendance_logs", (t) => {
    t.increments("id");
    t.integer("company_id").unsigned().notNullable().index();
    t.integer("device_id").unsigned().notNullable().index();
    t.integer("employee_id").unsigned().nullable().index();
    t.specificType("essl_user_id", "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin").nullable().index();
    t.dateTime("punch_time", { precision: 3 }).nullable().index();
    t.string("punch_type", 16).nullable();
    t.string("external_log_id", 191).nullable();
    t.string("dedup_key", 64).nullable();
    t.json("raw_payload").notNullable();
    t.uuid("sync_batch_id").notNullable().index();
    t.boolean("processed").notNullable().defaultTo(false);
    t.dateTime("processed_at", { precision: 3 }).nullable();
    t.text("processing_error").nullable();
    t.timestamps(true, true);
    t.foreign(["company_id", "device_id"]).references(["company_id", "id"]).inTable("essl_devices");
    t.unique(["company_id", "device_id", "dedup_key"], "essl_punch_unique");
    t.index(["company_id", "processed", "punch_time"], "essl_log_processing_index");
  });
  await knex.schema.createTable("essl_sync_logs", (t) => {
    t.increments("id");
    t.integer("company_id").unsigned().notNullable().index();
    t.integer("device_id").unsigned().notNullable().index();
    t.uuid("sync_batch_id").notNullable().unique();
    t.dateTime("started_at", { precision: 3 }).notNullable();
    t.dateTime("completed_at", { precision: 3 }).nullable();
    t.enum("status", ["RUNNING", "SUCCESS", "PARTIAL", "FAILED"]).notNullable();
    for (const field of ["fetched_count", "inserted_count", "duplicate_count", "processed_count", "failed_count"]) t.integer(field).unsigned().notNullable().defaultTo(0);
    t.text("error_message").nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.foreign(["company_id", "device_id"]).references(["company_id", "id"]).inTable("essl_devices");
  });
};
exports.down = async function (knex) {
  for (const table of ["essl_sync_logs", "essl_attendance_logs", "essl_employee_mappings", "essl_devices"]) await knex.schema.dropTableIfExists(table);
};

