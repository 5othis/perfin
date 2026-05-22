import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.resolve('data', 'perfin.db')

const db = new Database(DB_PATH)
db.pragma('journal_mode = DELETE')

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    type     TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    ord      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    date TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS balances (
    snapshot_date TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    amount        REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_date, account_id)
  );
`)

function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c
  if (count > 0) return

  const accountDefs: [string, string, number][] = [
    ['mbank funds', 'savings', 1],
    ['slsp funds', 'savings', 2],
    ['crypto', 'crypto', 3],
    ['slsp account', 'bank', 4],
    ['mbank account', 'bank', 5],
    ['binance account', 'crypto', 6],
    ['pss', 'savings', 7],
    ['Finax', 'investment', 8],
    ['cash', 'cash', 9],
    ['trading212', 'investment', 10],
    ['revolut', 'bank', 11],
    ['DT stock', 'investment', 12],
    ['IBKR stocks', 'investment', 13],
    ['Alpaca', 'investment', 14],
  ]
  const values = [12362.79, 8110, 90566, 11783, 889, 2.07, 7395, 14129, 2080, 21639, 6.60, 5302, 41682, 400.92]
  const snapshotDate = '2026-04-19'

  const insertAcc = db.prepare('INSERT INTO accounts (id, name, type, currency, ord) VALUES (?,?,?,?,?)')
  const insertBal = db.prepare('INSERT INTO balances (snapshot_date, account_id, amount) VALUES (?,?,?)')

  db.prepare('INSERT INTO snapshots (date) VALUES (?)').run(snapshotDate)

  const seed = db.transaction(() => {
    accountDefs.forEach(([name, type, ord], i) => {
      const id = uuidv4()
      insertAcc.run(id, name, type, 'EUR', ord)
      insertBal.run(snapshotDate, id, values[i])
    })
  })
  seed()
}

seedIfEmpty()

export default db
