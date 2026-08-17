import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "環境変数DATABASE_URLが未設定です。.env.exampleをコピーして設定してください。",
  );
}

const databaseSchema = process.env.DATABASE_SCHEMA ?? "public";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseSchema)) {
  throw new Error(
    "環境変数DATABASE_SCHEMAには小文字英数字とunderscoreだけを使用してください。",
  );
}

export const pool = new Pool({
  connectionString,
  options: `-c search_path=${databaseSchema},public`,
});

export async function pingDb(): Promise<void> {
  await pool.query("SELECT 1");
}
