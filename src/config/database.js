const { Pool } = require("pg");

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "wallet_db",
      user: process.env.DB_USER || "wallet_user",
      password: process.env.DB_PASSWORD || "1234",
    };

const pool = new Pool({
  ...databaseConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT_MS || "10000",
    10,
  ),
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// Test connection
pool.on("connect", () => {
  console.log("📦 PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected PostgreSQL error:", err);
  process.exit(-1);
});

// Helper function to get client with transaction
const getTransactionClient = async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  return client;
};

// Helper to commit and release
const commitTransaction = async (client) => {
  try {
    await client.query("COMMIT");
    client.release();
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    throw err;
  }
};

// Helper to rollback and release
const rollbackTransaction = async (client) => {
  try {
    await client.query("ROLLBACK");
  } catch (err) {
    console.error("Error during rollback:", err);
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  getTransactionClient,
  commitTransaction,
  rollbackTransaction,
};
