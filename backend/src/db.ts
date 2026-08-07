import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "Environment variable DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
}

export const pool = new Pool({ connectionString });

export async function pingDb(): Promise<void> {
  await pool.query("SELECT 1");
}
