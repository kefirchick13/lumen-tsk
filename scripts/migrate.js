const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { getDbPoolConfig } = require("../db-config");

const migrationsDir = path.join(__dirname, "..", "migrations");

async function main() {
  const db = new Pool(getDbPoolConfig());

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (rows.length) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await db.query("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }

  await db.end();
  console.log("Migrations completed.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
