const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const MIGRATIONS_DIR = __dirname;

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log("📦 Starting migrations...");

    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get executed migrations
    const { rows: executed } = await client.query(
      "SELECT name FROM migrations ORDER BY id",
    );
    const executedNames = new Set(executed.map((row) => row.name));

    // Get migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("⚠️ No migration files found");
      return;
    }

    console.log(`📋 Found ${files.length} migration files`);

    for (const file of files) {
      if (executedNames.has(file)) {
        console.log(`⏭️ Skipping already executed: ${file}`);
        continue;
      }

      console.log(`⏳ Executing migration: ${file}`);

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);

      console.log(`✅ Migration executed: ${file}`);
    }

    console.log("📦 All migrations completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("✅ Migration process completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Migration process failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
