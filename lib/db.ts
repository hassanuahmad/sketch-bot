import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "sketches.db");

function ensureSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sketches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      svg_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    ensureSchema(db);
  }
  return db;
}
