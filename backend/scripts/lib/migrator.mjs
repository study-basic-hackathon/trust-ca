import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function validateSchemaName(schema) {
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(
      `DATABASE_SCHEMAが不正です。小文字英数字とunderscoreだけを使用してください: ${schema}`,
    );
  }
  return schema;
}

export function quoteIdentifier(identifier) {
  validateSchemaName(identifier);
  return `"${identifier}"`;
}

async function loadMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const migrations = [];
  const versions = new Set();

  for (const filename of sqlFiles) {
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Migrationファイル名が規約外です: ${filename} (例: 0001_initial_schema.sql)`,
      );
    }

    const version = match[1];
    if (versions.has(version)) {
      throw new Error(`Migration versionが重複しています: ${version}`);
    }
    versions.add(version);

    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    migrations.push({ version, filename, checksum, sql });
  }

  if (migrations.length === 0) {
    throw new Error(`Migrationファイルが見つかりません: ${migrationsDirectory}`);
  }

  return migrations;
}

async function openClient(connectionString) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

async function readAppliedMigrations(client, schema) {
  const relation = `${schema}.schema_migrations`;
  const relationResult = await client.query(
    "SELECT to_regclass($1) AS relation_name",
    [relation],
  );

  if (relationResult.rows[0]?.relation_name === null) {
    return [];
  }

  const result = await client.query(
    `SELECT version, filename, checksum, applied_at
       FROM schema_migrations
      ORDER BY version`,
  );
  return result.rows;
}

function compareMigrationState(localMigrations, appliedMigrations) {
  const localByVersion = new Map(
    localMigrations.map((migration) => [migration.version, migration]),
  );
  const appliedByVersion = new Map(
    appliedMigrations.map((migration) => [migration.version, migration]),
  );

  for (const applied of appliedMigrations) {
    const local = localByVersion.get(applied.version);
    if (!local) {
      throw new Error(
        `適用済みmigration ${applied.version} (${applied.filename}) がローカルに存在しません`,
      );
    }
    if (local.filename !== applied.filename) {
      throw new Error(
        `Migration ${applied.version} のファイル名が変更されています: ${applied.filename} -> ${local.filename}`,
      );
    }
    if (local.checksum !== applied.checksum) {
      throw new Error(
        `Migration ${applied.version} (${local.filename}) のchecksumが適用時と一致しません`,
      );
    }
  }

  const pending = localMigrations.filter(
    (migration) => !appliedByVersion.has(migration.version),
  );
  const highestApplied = appliedMigrations.at(-1)?.version;
  if (
    highestApplied &&
    pending.some((migration) => migration.version < highestApplied)
  ) {
    throw new Error(
      `適用済みversion ${highestApplied} より前のmigrationを後から追加することはできません`,
    );
  }

  return pending;
}

export async function getMigrationStatus({
  connectionString,
  migrationsDirectory,
  schema = "public",
}) {
  validateSchemaName(schema);
  const localMigrations = await loadMigrations(migrationsDirectory);
  const client = await openClient(connectionString);

  try {
    await client.query(
      `SET search_path TO ${quoteIdentifier(schema)}, public`,
    );
    const applied = await readAppliedMigrations(client, schema);
    const pending = compareMigrationState(localMigrations, applied);
    return { local: localMigrations, applied, pending };
  } finally {
    await client.end();
  }
}

export async function runMigrations({
  connectionString,
  migrationsDirectory,
  schema = "public",
  logger = console,
}) {
  validateSchemaName(schema);
  const localMigrations = await loadMigrations(migrationsDirectory);
  const client = await openClient(connectionString);
  const lockName = `trustca_schema_migrations:${schema}`;
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    lockAcquired = true;
    const quotedSchema = quoteIdentifier(schema);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version varchar(4) PRIMARY KEY,
        filename varchar(255) NOT NULL UNIQUE,
        checksum varchar(64) NOT NULL,
        applied_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT schema_migrations_checksum_check
          CHECK (checksum ~ '^[0-9a-f]{64}$')
      )
    `);

    const applied = await readAppliedMigrations(client, schema);
    const pending = compareMigrationState(localMigrations, applied);

    for (const migration of pending) {
      logger.info(
        `Migration ${migration.version} (${migration.filename}) を適用します`,
      );
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, filename, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied: pending, alreadyApplied: applied };
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
      }
    } finally {
      await client.end();
    }
  }
}
