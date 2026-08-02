import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type { KycChecks, KycStatus } from "@/lib/didit/normalize";

export type Seller = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type SellerVerification = {
  sessionId: string;
  sellerId: string;
  status: KycStatus;
  checks: KycChecks | null;
  source: "webhook" | "poll" | "created";
  updatedAt: string;
  createdAt: string;
};

export type WebhookLogEntry = {
  id: number;
  sessionId: string;
  status: string;
  signatureMethod: string | null;
  isSignatureValid: boolean;
  createdAt: string;
};

export type VerificationEvent = {
  id: number;
  sessionId: string;
  eventType: "session_created" | "status_changed" | "checks_updated";
  fromStatus: KycStatus | null;
  toStatus: KycStatus;
  checks: KycChecks | null;
  source: string;
  createdAt: string;
};

function resolveDbPath(): string {
  // EKYC_DB_PATH lets tests point at an isolated database file.
  if (process.env.EKYC_DB_PATH) {
    return process.env.EKYC_DB_PATH;
  }
  return path.join(process.cwd(), "data", "ekyc.db");
}

function createConnection(): Database.Database {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists sellers (
      id text primary key,
      display_name text not null,
      created_at text not null default (datetime('now'))
    );

    create table if not exists seller_verifications (
      session_id text primary key,
      seller_id text not null references sellers(id),
      status text not null,
      checks_json text,
      source text not null,
      updated_at text not null default (datetime('now')),
      created_at text not null default (datetime('now'))
    );

    create table if not exists webhook_logs (
      id integer primary key autoincrement,
      session_id text not null,
      status text not null,
      signature_method text,
      signature_valid integer not null,
      raw_payload text not null,
      created_at text not null default (datetime('now'))
    );

    create table if not exists verification_events (
      id integer primary key autoincrement,
      session_id text not null,
      event_type text not null,
      from_status text,
      to_status text not null,
      checks_json text,
      source text not null,
      created_at text not null default (datetime('now'))
    );
  `);
  return db;
}

// Survive Next.js dev-server HMR without opening a new handle per reload.
const globalForDb = globalThis as unknown as { ekycDb?: Database.Database };

function getDb(): Database.Database {
  if (!globalForDb.ekycDb) {
    globalForDb.ekycDb = createConnection();
  }
  return globalForDb.ekycDb;
}

export function createSeller(displayName: string): Seller {
  const id = randomUUID();
  getDb()
    .prepare("insert into sellers (id, display_name) values (?, ?)")
    .run(id, displayName);
  return getSellerById(id) as Seller;
}

export function getSellerById(id: string): Seller | null {
  const row = getDb()
    .prepare(
      "select id, display_name as displayName, created_at as createdAt from sellers where id = ?",
    )
    .get(id) as Seller | undefined;
  return row ?? null;
}

type VerificationRow = {
  sessionId: string;
  sellerId: string;
  status: KycStatus;
  checksJson: string | null;
  source: SellerVerification["source"];
  updatedAt: string;
  createdAt: string;
};

function toVerification(row: VerificationRow): SellerVerification {
  return {
    sessionId: row.sessionId,
    sellerId: row.sellerId,
    status: row.status,
    checks: row.checksJson ? (JSON.parse(row.checksJson) as KycChecks) : null,
    source: row.source,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function insertEvent(input: {
  sessionId: string;
  eventType: VerificationEvent["eventType"];
  fromStatus: KycStatus | null;
  toStatus: KycStatus;
  checks: KycChecks | null;
  source: string;
}): void {
  getDb()
    .prepare(
      `insert into verification_events
         (session_id, event_type, from_status, to_status, checks_json, source)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      input.eventType,
      input.fromStatus,
      input.toStatus,
      input.checks ? JSON.stringify(input.checks) : null,
      input.source,
    );
}

export function createVerification(input: {
  sessionId: string;
  sellerId: string;
}): void {
  const db = getDb();
  const create = db.transaction(() => {
    db.prepare(
      `insert into seller_verifications (session_id, seller_id, status, source)
       values (?, ?, 'not_started', 'created')`,
    ).run(input.sessionId, input.sellerId);
    insertEvent({
      sessionId: input.sessionId,
      eventType: "session_created",
      fromStatus: null,
      toStatus: "not_started",
      checks: null,
      source: "created",
    });
  });
  create();
}

export function updateVerification(input: {
  sessionId: string;
  status: KycStatus;
  checks: KycChecks | null;
  source: "webhook" | "poll";
}): boolean {
  const db = getDb();
  const update = db.transaction((): boolean => {
    const existing = getVerificationBySessionId(input.sessionId);
    if (!existing) {
      return false;
    }

    db.prepare(
      `update seller_verifications
       set status = ?, checks_json = ?, source = ?, updated_at = datetime('now')
       where session_id = ?`,
    ).run(
      input.status,
      input.checks ? JSON.stringify(input.checks) : null,
      input.source,
      input.sessionId,
    );

    const isStatusChanged = existing.status !== input.status;
    const isChecksChanged =
      JSON.stringify(existing.checks) !== JSON.stringify(input.checks);

    if (isStatusChanged) {
      insertEvent({
        sessionId: input.sessionId,
        eventType: "status_changed",
        fromStatus: existing.status,
        toStatus: input.status,
        checks: input.checks,
        source: input.source,
      });
    } else if (isChecksChanged) {
      insertEvent({
        sessionId: input.sessionId,
        eventType: "checks_updated",
        fromStatus: existing.status,
        toStatus: input.status,
        checks: input.checks,
        source: input.source,
      });
    }
    return true;
  });
  return update();
}

export function getEventsForSession(sessionId: string): VerificationEvent[] {
  const rows = getDb()
    .prepare(
      `select id, session_id as sessionId, event_type as eventType,
              from_status as fromStatus, to_status as toStatus,
              checks_json as checksJson, source, created_at as createdAt
       from verification_events
       where session_id = ?
       order by id asc`,
    )
    .all(sessionId) as Array<
    Omit<VerificationEvent, "checks"> & { checksJson: string | null }
  >;
  return rows.map(({ checksJson, ...rest }) => ({
    ...rest,
    checks: checksJson ? (JSON.parse(checksJson) as KycChecks) : null,
  }));
}

export function getVerificationBySessionId(
  sessionId: string,
): SellerVerification | null {
  const row = getDb()
    .prepare(
      `select session_id as sessionId, seller_id as sellerId, status,
              checks_json as checksJson, source,
              updated_at as updatedAt, created_at as createdAt
       from seller_verifications where session_id = ?`,
    )
    .get(sessionId) as VerificationRow | undefined;
  return row ? toVerification(row) : null;
}

export function getLatestVerificationForSeller(
  sellerId: string,
): SellerVerification | null {
  const row = getDb()
    .prepare(
      `select session_id as sessionId, seller_id as sellerId, status,
              checks_json as checksJson, source,
              updated_at as updatedAt, created_at as createdAt
       from seller_verifications
       where seller_id = ?
       order by created_at desc, rowid desc
       limit 1`,
    )
    .get(sellerId) as VerificationRow | undefined;
  return row ? toVerification(row) : null;
}

export function insertWebhookLog(input: {
  sessionId: string;
  status: string;
  signatureMethod: string | null;
  isSignatureValid: boolean;
  rawPayload: string;
}): void {
  getDb()
    .prepare(
      `insert into webhook_logs
         (session_id, status, signature_method, signature_valid, raw_payload)
       values (?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      input.status,
      input.signatureMethod,
      input.isSignatureValid ? 1 : 0,
      input.rawPayload,
    );
}

export function getRecentWebhookLogs(limit = 20): WebhookLogEntry[] {
  const rows = getDb()
    .prepare(
      `select id, session_id as sessionId, status,
              signature_method as signatureMethod,
              signature_valid as signatureValid,
              created_at as createdAt
       from webhook_logs order by id desc limit ?`,
    )
    .all(limit) as Array<Omit<WebhookLogEntry, "isSignatureValid"> & { signatureValid: number }>;
  return rows.map(({ signatureValid, ...rest }) => ({
    ...rest,
    isSignatureValid: signatureValid === 1,
  }));
}
