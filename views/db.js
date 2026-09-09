const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'reflog.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// A "ref" here is just whoever's using the app — this is a personal tool,
// not tied to any one league or organization, so there's no admin handing
// out PINs. Anyone can create their own profile with a name + a PIN they
// pick themselves, and that PIN alone logs them back into their own games
// (same "PIN is your identity" pattern as Reffi, but self-serve instead of
// admin-issued since there's no owner role here).
db.exec(`
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  default_pay REAL,
  timezone TEXT NOT NULL DEFAULT 'America/Denver',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// status:
//   normal       — a game you're refereeing as originally assigned
//   picked_up    — you took this game from another ref (swap_name = who)
//   given_away   — you gave this game to another ref (swap_name = who) —
//                  kept in history so you can see who's covering it, but
//                  excluded from "upcoming" counts and pay totals since
//                  it's no longer actually yours to work.
db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_id INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  location TEXT,
  league TEXT,
  level TEXT,
  notes TEXT,
  pay REAL,
  status TEXT NOT NULL DEFAULT 'normal',
  swap_name TEXT,
  swap_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
