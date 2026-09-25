import { readFile } from 'node:fs/promises'

export const transactionFile = new URL('../fund_transactions_2019-2025.csv', import.meta.url)
const columns = ['date', 'isin', 'fund', 'operation', 'amount_eur']

class CsvError extends Error {}

function csvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let closedQuote = false
  const input = text.replace(/^\uFEFF/, '')
  const finishField = () => {
    row.push(field)
    field = ''
    closedQuote = false
  }
  const finishRow = () => {
    finishField()
    if (row.some(value => value !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++ }
        else { quoted = false; closedQuote = true }
      } else field += char
    } else if (char === ',') {
      finishField()
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      finishRow()
    } else if (char === '"' && !field && !closedQuote) {
      quoted = true
    } else {
      if (closedQuote || char === '"') throw new CsvError('Invalid CSV quoting. No transactions were imported.')
      field += char
    }
  }
  if (quoted) throw new CsvError('Unclosed CSV quote. No transactions were imported.')
  if (field || row.length || closedQuote) finishRow()
  return rows
}

function safeCents(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new CsvError('Transaction totals exceed the supported amount range.')
  }
  return Number(value)
}

export function parseTransactions(text, holdings) {
  const [header, ...rows] = csvRows(text)
  if (!header || new Set(header).size !== header.length || columns.some(column => !header.includes(column))) {
    throw new CsvError('CSV must contain date, isin, fund, operation, and amount_eur columns.')
  }
  if (!rows.length) throw new CsvError('The CSV has no transactions.')
  const known = new Map(holdings.map(holding => [holding.isin, holding]))
  const transactions = rows.map((row, index) => {
    const error = () => new CsvError(`Invalid CSV record ${index + 2}. Check date, known ISIN, fund, buy/sell operation, and positive EUR amount with at most two decimals. No transactions were imported.`)
    if (row.length !== header.length) throw error()
    const get = column => row[header.indexOf(column)].trim()
    const date = get('date')
    const parsedDate = new Date(`${date}T00:00:00Z`)
    const isin = get('isin')
    const operation = get('operation')
    const amount = get('amount_eur')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date || !known.has(isin) ||
        !get('fund') || !['buy', 'sell'].includes(operation) || !/^\d+(?:\.\d{1,2})?$/.test(amount)) throw error()
    const [whole, fraction = ''] = amount.split('.')
    const amountCents = safeCents(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
    if (amountCents <= 0) throw error()
    return { date, isin, fund: get('fund'), operation, amountCents, record: index + 2 }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.record - b.record)

  const byFund = new Map()
  const byDate = new Map()
  let purchases = 0n
  let sales = 0n
  for (const transaction of transactions) {
    const amount = BigInt(transaction.amountCents)
    const signed = transaction.operation === 'buy' ? amount : -amount
    if (signed > 0n) purchases += amount
    else sales += amount
    const total = byFund.get(transaction.isin) ?? {
      isin: transaction.isin, name: known.get(transaction.isin).name, purchases: 0n, sales: 0n, count: 0,
    }
    if (signed > 0n) total.purchases += amount
    else total.sales += amount
    total.count++
    byFund.set(transaction.isin, total)
    byDate.set(transaction.date, (byDate.get(transaction.date) ?? 0n) + signed)
  }
  let cumulative = 0n
  const points = [...byDate].map(([date, change]) => {
    cumulative += change
    return { date, valueCents: safeCents(cumulative) }
  })
  return {
    status: 'available', message: null, count: transactions.length,
    firstDate: transactions[0].date, lastDate: transactions.at(-1).date,
    purchasesCents: safeCents(purchases), salesCents: safeCents(sales),
    netInvestedCents: safeCents(purchases - sales),
    byFund: [...byFund.values()].map(({ isin, name, purchases, sales, count }) => ({
      isin, name, count, purchasesCents: safeCents(purchases), salesCents: safeCents(sales),
      netInvestedCents: safeCents(purchases - sales),
    })),
    transactions, points,
  }
}

export async function loadTransactions(holdings, file = transactionFile) {
  try {
    return parseTransactions(await readFile(file, 'utf8'), holdings)
  } catch (error) {
    if (error instanceof CsvError) return { status: 'invalid', message: error.message }
    if (error.code === 'ENOENT') {
      return { status: 'missing', message: 'Place fund_transactions_2019-2025.csv in the project folder, then Refresh.' }
    }
    if (['EACCES', 'EPERM', 'EISDIR'].includes(error.code)) {
      return { status: 'unavailable', message: 'Cannot read the transaction CSV. Check the file and its permissions.' }
    }
    throw error
  }
}
