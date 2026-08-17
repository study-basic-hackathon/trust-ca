import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getMigrationStatus,
  runMigrations,
} from "./lib/migrator.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(
  currentDirectory,
  "../src/db/migrations",
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "環境変数DATABASE_URLが未設定です。.env.exampleを参照してください。",
  );
}

const schema = process.env.DATABASE_SCHEMA ?? "public";
const argumentsList = process.argv.slice(2);
const unknownArguments = argumentsList.filter((argument) => argument !== "--status");
if (unknownArguments.length > 0) {
  throw new Error(`未対応の引数です: ${unknownArguments.join(", ")}`);
}

if (argumentsList.includes("--status")) {
  const status = await getMigrationStatus({
    connectionString,
    migrationsDirectory,
    schema,
  });
  console.log(`適用済み: ${status.applied.length}件`);
  for (const migration of status.applied) {
    console.log(`  [applied] ${migration.version} ${migration.filename}`);
  }
  console.log(`未適用: ${status.pending.length}件`);
  for (const migration of status.pending) {
    console.log(`  [pending] ${migration.version} ${migration.filename}`);
  }
} else {
  const result = await runMigrations({
    connectionString,
    migrationsDirectory,
    schema,
  });
  console.log(
    `Migration完了: 新規${result.applied.length}件、適用済み${result.alreadyApplied.length}件`,
  );
}
