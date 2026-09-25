import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTransactions, loadTransactions } from '../lib/transactions.js'

const holdings = [{ isin: 'TEST_A', name: 'Test fund A' }, { isin: 'TEST_B', name: 'Test fund B' }]
const header = 'date,isin,fund,operation,amount_eur\n'
const record = '2020-01-01,TEST_A,Test A,buy,50.00'

test('sorts the complete ledger, groups dates, and calculates exact purchase/sale totals', () => {
  const data = parseTransactions(header + [
    '2021-01-01,TEST_A,Test A,sell,20.01',
    '2019-01-01,TEST_B,Test B,buy,0.20',
    '2019-01-01,TEST_A,Test A,buy,0.10',
    '2020-01-01,TEST_A,Test A,buy,50.00',
  ].join('\n'), holdings)
  assert.equal(data.count, 4)
  assert.equal(data.firstDate, '2019-01-01')
  assert.equal(data.lastDate, '2021-01-01')
  assert.equal(data.purchasesCents, 5030)
  assert.equal(data.salesCents, 2001)
  assert.equal(data.netInvestedCents, 3029)
  assert.deepEqual(data.points, [
    { date: '2019-01-01', valueCents: 30 },
    { date: '2020-01-01', valueCents: 5030 },
    { date: '2021-01-01', valueCents: 3029 },
  ])
  assert.equal(data.byFund.find(fund => fund.isin === 'TEST_A').netInvestedCents, 3009)
  assert.equal(data.transactions[0].operation, 'buy')
  assert.equal(data.transactions.at(-1).operation, 'sell')
  assert.ok(data.transactions.every(row => !Object.hasOwn(row, 'units')))
})

test('supports quoted commas, escaped quotes, multiline names, BOM, CRLF, and reordered columns', () => {
  const csv = '\uFEFFamount_eur,fund,isin,date,operation\r\n12.34,"Test, ""A""\r\nFund",TEST_A,2020-01-01,buy\r\n'
  const data = parseTransactions(csv, holdings)
  assert.equal(data.netInvestedCents, 1234)
  assert.equal(data.transactions[0].fund, 'Test, "A"\r\nFund')
})

test('preserves duplicate-looking transactions, ignores blank lines, and accepts an unterminated final line', () => {
  const data = parseTransactions(header + `\n${record}\n\n${record}`, holdings)
  assert.equal(data.count, 2)
  assert.deepEqual(data.points, [{ date: '2020-01-01', valueCents: 10000 }])
})

test('supports positive amounts with zero, one or two decimals and net withdrawals', () => {
  const data = parseTransactions(header + [
    '2020-01-01,TEST_A,Test A,buy,1',
    '2020-01-02,TEST_A,Test A,buy,1.1',
    '2020-01-03,TEST_A,Test A,sell,3.50',
  ].join('\n'), holdings)
  assert.equal(data.netInvestedCents, -140)
})

test('rejects malformed rows and unsupported operations in full without exposing their contents', () => {
  const invalid = [
    '2020-02-30,TEST_A,Test A,buy,50',
    'yesterday,TEST_A,Test A,buy,50',
    '2020-01-01,UNKNOWN,Test A,buy,50',
    '2020-01-01,TEST_A,,buy,50',
    '2020-01-01,TEST_A,Test A,dividend,50',
    '2020-01-01,TEST_A,Test A,buy,-50',
    '2020-01-01,TEST_A,Test A,buy,0',
    '2020-01-01,TEST_A,Test A,buy,0.005',
    '2020-01-01,TEST_A,Test A,buy,1e3',
    '2020-01-01,TEST_A,Test A,buy,"1,50"',
    '2020-01-01,TEST_A,Test A,buy,50,extra',
    '2020-01-01,TEST_A,Test A,buy',
    '2020-01-01,TEST_A,"bad quote,buy,50',
    '2020-01-01,TEST_A,"closed"trailing,buy,50',
  ]
  for (const line of invalid) assert.throws(() => parseTransactions(header + record + '\n' + line, holdings))
  assert.throws(() => parseTransactions(header + 'SECRET', holdings), error => !error.message.includes('SECRET'))
})

test('rejects missing or duplicate headers, empty CSVs and unsafe totals', () => {
  for (const csv of ['', header, 'date,fund\n2020-01-01,Test A', header.replace('fund', 'isin') + record]) {
    assert.throws(() => parseTransactions(csv, holdings))
  }
  assert.throws(() => parseTransactions(header + record.replace('50.00', '90071992547410'), holdings))
  assert.throws(() => parseTransactions(header + [
    record.replace('50.00', '90071992547409.90'), record,
  ].join('\n'), holdings))
})

test('file loader reports missing and invalid files, and rereads changes on refresh', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'portfolio-csv-test-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'transactions.csv')
  assert.equal((await loadTransactions(holdings, path)).status, 'missing')
  await writeFile(path, 'not,a,transaction')
  assert.equal((await loadTransactions(holdings, path)).status, 'invalid')
  await writeFile(path, header + record)
  assert.equal((await loadTransactions(holdings, path)).netInvestedCents, 5000)
  await writeFile(path, header + record + '\n' + record)
  assert.equal((await loadTransactions(holdings, path)).netInvestedCents, 10000)
})
