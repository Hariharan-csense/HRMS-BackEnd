const crypto = require("node:crypto");

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const encode = (value) => JSON.stringify(value, function (key, item) {
  const original = this[key];
  if (original instanceof Date) return { $date: original.toISOString() };
  if (Buffer.isBuffer(original)) return { $buffer: original.toString("base64") };
  return item;
});
const decode = (value) => JSON.parse(value, (_key, item) => {
  if (item && typeof item === "object" && Object.keys(item).length === 1) {
    if (item.$date) return new Date(item.$date);
    if (item.$buffer) return Buffer.from(item.$buffer, "base64");
  }
  return item;
});
const archiveKey = () => {
  const secret = process.env.DELETION_ARCHIVE_KEY || process.env.JWT_SECRET;
  if (!secret) fail(503, "Deletion archive encryption is not configured");
  return crypto.createHash("sha256").update(`hrms-deletion-archive:${secret}`).digest();
};
const encrypt = (data) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", archiveKey(), iv);
  const body = Buffer.concat([cipher.update(encode(data), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
};
const decrypt = (value) => {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1") fail(409, "Unsupported deletion archive version");
  const cipher = crypto.createDecipheriv("aes-256-gcm", archiveKey(), Buffer.from(iv, "base64"));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return decode(Buffer.concat([cipher.update(Buffer.from(body, "base64")), cipher.final()]).toString("utf8"));
};

async function readSchema(db) {
  const [columns] = await db.raw(`SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_KEY, c.DATA_TYPE, c.EXTRA, t.ENGINE
    FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA = DATABASE() ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
  const [links] = await db.raw(`SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
    k.REFERENCED_COLUMN_NAME, k.CONSTRAINT_NAME, r.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`);
  const tables = {};
  for (const c of columns) (tables[c.TABLE_NAME] ||= []).push(c);
  const grouped = new Map();
  for (const link of links) {
    const key = `${link.TABLE_NAME}:${link.CONSTRAINT_NAME}`;
    if (!grouped.has(key)) grouped.set(key, { table: link.TABLE_NAME, parent: link.REFERENCED_TABLE_NAME, rule: link.DELETE_RULE, columns: [] });
    grouped.get(key).columns.push([link.COLUMN_NAME, link.REFERENCED_COLUMN_NAME]);
  }
  return { tables, links: [...grouped.values()] };
}

function identity(schema, table, row) {
  const engine = schema.tables[table]?.[0]?.ENGINE;
  if (engine && engine !== "InnoDB") fail(409, `${table} does not support the transactions required for safe restore`);
  const keys = (schema.tables[table] || []).filter((c) => c.COLUMN_KEY === "PRI").map((c) => c.COLUMN_NAME);
  if (!keys.length) fail(409, `Cannot safely archive ${table}: a primary key is required`);
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

// Snapshot everything MySQL will cascade-delete or set to NULL. Files are retained.
// RESTRICT/NO ACTION references remain database-enforced; never disable FK checks.
async function collectArchive(db, roots, schema, companyId) {
  const deleted = new Map();
  const updates = new Map();
  const visiting = new Set();
  const insertOrder = [];
  const rootQueries = [];
  const visit = async (table, row) => {
    if (table === "deletion_drafts") fail(409, "Deletion archives cannot be deleted");
    const key = identity(schema, table, row);
    const token = `${table}:${encode(key)}`;
    if (visiting.has(token)) fail(409, "Circular record dependencies prevent safe deletion");
    if (deleted.has(token)) return;
    const companyColumn = schema.tables[table].find((c) => ["company_id", "companyId"].includes(c.COLUMN_NAME));
    if (companyId != null && companyColumn && row[companyColumn.COLUMN_NAME] != null && String(row[companyColumn.COLUMN_NAME]) !== String(companyId)) {
      fail(409, "A linked record belongs to another company; deletion was blocked");
    }
    visiting.add(token);
    deleted.set(token, { table, key, row });
    for (const link of schema.links.filter((l) => l.parent === table && ["CASCADE", "SET NULL"].includes(l.rule))) {
      const where = Object.fromEntries(link.columns.map(([child, parent]) => [child, row[parent]]));
      const children = await db(link.table).where(where).forUpdate();
      for (const child of children) {
        const tenantColumn = schema.tables[link.table].find((c) => ["company_id", "companyId"].includes(c.COLUMN_NAME));
        if (companyId != null && tenantColumn && child[tenantColumn.COLUMN_NAME] != null && String(child[tenantColumn.COLUMN_NAME]) !== String(companyId)) {
          fail(409, "A linked record belongs to another company; deletion was blocked");
        }
        if (link.rule === "CASCADE") await visit(link.table, child);
        else {
          const childKey = identity(schema, link.table, child);
          const childToken = `${link.table}:${encode(childKey)}`;
          const entry = updates.get(childToken) || { table: link.table, key: childKey, before: {}, after: {} };
          for (const [column] of link.columns) { entry.before[column] = child[column]; entry.after[column] = null; }
          updates.set(childToken, entry);
        }
      }
    }
    visiting.delete(token);
    insertOrder.unshift(token);
  };
  for (const root of roots) {
    const rows = await db(root.table).where(root.where).forUpdate();
    for (const row of rows) {
      await visit(root.table, row);
      rootQueries.push({ table: root.table, where: identity(schema, root.table, row) });
    }
  }
  return {
    records: insertOrder.map((key) => deleted.get(key)),
    updates: [...updates.entries()].filter(([key]) => !deleted.has(key)).map(([, value]) => value),
    roots: rootQueries,
  };
}

const fingerprint = (archive) => {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    return value;
  };
  const normalized = JSON.parse(encode(archive));
  for (const key of ["records", "updates", "roots"]) {
    normalized[key] = normalized[key].map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return crypto.createHash("sha256").update(JSON.stringify(stable(normalized))).digest("hex");
};

function insertable(schema, table, row) {
  if (Object.keys(row).some((key) => !schema.tables[table]?.some((c) => c.COLUMN_NAME === key))) {
    fail(409, "The database schema changed after deletion. Restore requires an explicit schema mapping; nothing was changed.");
  }
  return Object.fromEntries(Object.entries(row).filter(([key]) => {
    const column = schema.tables[table]?.find((c) => c.COLUMN_NAME === key);
    return column && !/GENERATED/.test(column.EXTRA || "");
  }).map(([key, value]) => {
    const column = schema.tables[table].find((c) => c.COLUMN_NAME === key);
    return [key, column.DATA_TYPE === "json" && value != null && typeof value !== "string" ? JSON.stringify(value) : value];
  }));
}

async function restoreArchive(db, archive, schema) {
  for (const record of archive.records) {
    if (await db(record.table).where(record.key).first()) fail(409, "A record with the original ID already exists. Nothing was restored.");
  }
  // Resolve parent dependencies across multiple roots without disabling FK checks.
  let remaining = [...archive.records];
  while (remaining.length) {
    const retry = [];
    for (const record of remaining) {
      try { await db(record.table).insert(insertable(schema, record.table, record.row)); }
      catch (error) {
        if (error.code === "ER_NO_REFERENCED_ROW_2") retry.push(record);
        else if (error.code === "ER_DUP_ENTRY") fail(409, "A unique value is already in use. Nothing was restored.");
        else throw error;
      }
    }
    if (retry.length === remaining.length) fail(409, "A required parent record is missing. Restore it first; nothing was changed.");
    remaining = retry;
  }
  for (const update of archive.updates) {
    const row = await db(update.table).where(update.key).forUpdate().first();
    if (!row || Object.keys(update.after).some((key) => encode(row[key]) !== encode(update.after[key]))) {
      fail(409, "A linked record has changed. Nothing was restored.");
    }
    await db(update.table).where(update.key).update(update.before);
  }
}

module.exports = { fail, encode, decode, encrypt, decrypt, readSchema, identity, collectArchive, fingerprint, restoreArchive };
