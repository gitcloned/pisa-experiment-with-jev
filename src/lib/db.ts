import "server-only";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.NEON_STORAGE_NILEDB_URL ?? process.env.NEON_STORAGE_NILEDB_POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

export default pool;

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT,
      image       TEXT,
      first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visit_count INTEGER NOT NULL DEFAULT 1
    );
  `);
}

export async function upsertUser(email: string, name?: string | null, image?: string | null) {
  await pool.query(
    `INSERT INTO users (email, name, image)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET name        = COALESCE($2, users.name),
           image       = COALESCE($3, users.image),
           last_seen   = NOW(),
           visit_count = users.visit_count + 1`,
    [email, name ?? null, image ?? null]
  );
  console.log(`[auth] ${email} signed in at ${new Date().toISOString()}`);
}

export async function getUsers() {
  const res = await pool.query(
    `SELECT email, name, first_seen, last_seen, visit_count
     FROM users ORDER BY last_seen DESC`
  );
  return res.rows;
}
