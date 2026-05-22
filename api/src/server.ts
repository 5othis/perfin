import express from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import db from './db.js'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT ?? 3001)

// ── Accounts ──────────────────────────────────────────────────────────────────

app.get('/api/accounts', (_req, res) => {
  const rows = db.prepare('SELECT id, name, type, currency, ord as "order" FROM accounts ORDER BY ord').all()
  res.json(rows)
})

app.post('/api/accounts', (req, res) => {
  const { name, type } = req.body as { name: string; type: string }
  const maxRow = db.prepare('SELECT MAX(ord) as m FROM accounts').get() as { m: number | null }
  const ord = (maxRow.m ?? 0) + 1
  const id = uuidv4()
  db.prepare('INSERT INTO accounts (id, name, type, currency, ord) VALUES (?,?,?,?,?)').run(id, name, type, 'EUR', ord)
  res.status(201).json({ id, name, type, currency: 'EUR', order: ord })
})

app.put('/api/accounts/:id', (req, res) => {
  const { name, type } = req.body as { name: string; type: string }
  db.prepare('UPDATE accounts SET name=?, type=? WHERE id=?').run(name, type, req.params.id)
  res.json({ ok: true })
})

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id)
  db.prepare('DELETE FROM balances WHERE account_id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Snapshots ─────────────────────────────────────────────────────────────────

app.get('/api/snapshots', (_req, res) => {
  const dates = (db.prepare('SELECT date FROM snapshots ORDER BY date').all() as { date: string }[]).map(r => r.date)
  const balRows = db.prepare('SELECT snapshot_date, account_id, amount FROM balances').all() as {
    snapshot_date: string; account_id: string; amount: number
  }[]

  const balMap: Record<string, Record<string, number>> = {}
  for (const row of balRows) {
    if (!balMap[row.snapshot_date]) balMap[row.snapshot_date] = {}
    balMap[row.snapshot_date][row.account_id] = row.amount
  }

  res.json(dates.map(date => ({ date, balances: balMap[date] ?? {} })))
})

app.put('/api/snapshots/:date', (req, res) => {
  const { date } = req.params
  const balances = req.body as Record<string, number>

  const save = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO snapshots (date) VALUES (?)').run(date)
    db.prepare('DELETE FROM balances WHERE snapshot_date=?').run(date)
    const stmt = db.prepare('INSERT INTO balances (snapshot_date, account_id, amount) VALUES (?,?,?)')
    for (const [accountId, amount] of Object.entries(balances)) {
      stmt.run(date, accountId, amount)
    }
  })
  save()
  res.json({ ok: true })
})

app.delete('/api/snapshots/:date', (req, res) => {
  db.prepare('DELETE FROM snapshots WHERE date=?').run(req.params.date)
  db.prepare('DELETE FROM balances WHERE snapshot_date=?').run(req.params.date)
  res.json({ ok: true })
})

// ── Full replace (import) ─────────────────────────────────────────────────────

app.post('/api/import', (req, res) => {
  const { accounts, snapshots } = req.body as {
    accounts: { id: string; name: string; type: string; currency: string; order: number }[]
    snapshots: { date: string; balances: Record<string, number> }[]
  }

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM balances').run()
    db.prepare('DELETE FROM snapshots').run()
    db.prepare('DELETE FROM accounts').run()

    const accStmt = db.prepare('INSERT INTO accounts (id, name, type, currency, ord) VALUES (?,?,?,?,?)')
    for (const a of accounts) accStmt.run(a.id, a.name, a.type, a.currency, a.order)

    const snapStmt = db.prepare('INSERT OR IGNORE INTO snapshots (date) VALUES (?)')
    const balStmt = db.prepare('INSERT INTO balances (snapshot_date, account_id, amount) VALUES (?,?,?)')
    for (const s of snapshots) {
      snapStmt.run(s.date)
      for (const [aid, amt] of Object.entries(s.balances)) balStmt.run(s.date, aid, amt)
    }
  })
  replace()
  res.json({ ok: true })
})

app.listen(PORT, () => console.log(`perfin-api listening on :${PORT}`))
