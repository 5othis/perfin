import test from 'node:test'
import assert from 'node:assert/strict'
import { fundHistory, portfolioHistory } from '../lib/history.js'
import { periodPoints, selectedChartData } from '../public/chart.js'

const fund = (isin, units, history) => ({ isin, units, history, status: 'available' })

test('individual price history retains dates excluded from the combined series', () => {
  const first = fund('a', '1.882', [
    { date: '2026-09-24', close: 123.45 }, { date: '2026-09-23', close: 100 },
  ])
  const second = fund('b', '1', [{ date: '2026-09-23', close: 5 }])
  assert.deepEqual(fundHistory(first), [
    { date: '2026-09-23', valueCents: 18820 }, { date: '2026-09-24', valueCents: 23233 },
  ])
  assert.equal(portfolioHistory([first, second]).points.length, 1)
  assert.deepEqual(fundHistory({ status: 'unavailable' }), [])
})

test('picker selects a fund value history without changing all-fund totals or applying other-fund partial status', () => {
  const history = { points: [{ date: '2026-01-01', valueCents: 100 }], partial: true, includedIsins: ['a'] }
  const funds = [
    { isin: 'a', name: 'Fund A', status: 'available', valueHistory: [{ date: '2026-01-02', valueCents: 200 }] },
    { isin: 'b', name: 'Fund B', status: 'unavailable', message: 'Provider offline.', valueHistory: [] },
  ]
  const all = selectedChartData(history, funds, null, 'ALL', 'portfolio')
  assert.equal(all.points, history.points)
  assert.equal(all.title, 'Historical value of current holdings')
  assert.match(all.coverage, /Partial coverage/)
  const single = selectedChartData(history, funds, null, ['a'], 'portfolio')
  assert.equal(single.points, funds[0].valueHistory)
  assert.equal(single.title, 'Historical value of current holdings')
  assert.match(single.coverage, /Fund A · a/)
  assert.doesNotMatch(single.title, /Partial/)
  const missing = selectedChartData(history, funds, null, ['b'], 'portfolio')
  assert.deepEqual(missing.points, [])
  assert.match(missing.coverage, /Provider offline/)
})

test('individual invested series filters by ISIN before grouping, sorting, and accumulating all prior transactions', () => {
  const transactions = {
    status: 'available', byFund: [{ isin: 'a', name: 'Fund A' }],
    transactions: [
      { isin: 'a', date: '2026-03-01', operation: 'sell', amountCents: 50 },
      { isin: 'b', date: '2026-02-01', operation: 'buy', amountCents: 9000 },
      { isin: 'a', date: '2026-01-01', operation: 'buy', amountCents: 101 },
      { isin: 'a', date: '2026-01-01', operation: 'buy', amountCents: 202 },
    ],
    points: [{ date: '2026-03-01', valueCents: 9253 }],
  }
  const result = selectedChartData(null, [], transactions, ['a'], 'invested')
  assert.deepEqual(result.points, [
    { date: '2026-01-01', valueCents: 303 }, { date: '2026-03-01', valueCents: 253 },
  ])
  assert.equal(periodPoints(result.points, '1M')[0].valueCents, 253)
  assert.match(result.coverage, /3 transactions/)
  assert.equal(selectedChartData(null, [], transactions, 'ALL', 'invested').points, transactions.points)
  const missing = selectedChartData(null, [], transactions, ['c'], 'invested')
  assert.deepEqual(missing.points, [])
  assert.match(missing.empty, /No CSV transactions/)
  assert.deepEqual(selectedChartData(null, [], { status: 'invalid', message: 'Bad CSV' }, ['a'], 'invested').points, [])
})

test('checkbox selection sums only selected holdings on their shared dates', () => {
  const funds = [
    { isin: 'fund-a', status: 'available', valueHistory: [
      { date: '2026-01-01', valueCents: 101 }, { date: '2026-01-02', valueCents: 202 },
    ] },
    { isin: 'fund-b', status: 'available', valueHistory: [
      { date: '2026-01-02', valueCents: 303 }, { date: '2026-01-03', valueCents: 404 },
    ] },
    { isin: 'fund-c', status: 'unavailable', valueHistory: [] },
  ]
  const data = selection => selectedChartData(null, funds, null, selection, 'portfolio')
  assert.deepEqual(data(['fund-a', 'fund-b']).points, [{ date: '2026-01-02', valueCents: 505 }])
  assert.doesNotMatch(data(['fund-a', 'fund-b']).title, /Partial/)
  assert.deepEqual(data(['fund-a', 'fund-c']).points, funds[0].valueHistory)
  assert.equal(data(['fund-a', 'fund-c']).title, 'Historical value of current holdings')
  assert.match(data(['fund-a', 'fund-c']).coverage, /Partial coverage/)
  assert.match(data(['fund-a', 'fund-c']).coverage, /1 of 2/)
  assert.deepEqual(data(['fund-c']).points, [])
  assert.deepEqual(data(['fund-a', 'fund-b', 'fund-c']).points, [{ date: '2026-01-02', valueCents: 505 }])
  funds[1].valueHistory = [{ date: '2026-01-03', valueCents: 404 }]
  assert.deepEqual(data(['fund-a', 'fund-b']).points, [])
  funds[1].valueHistory = [{ date: '2026-01-01', valueCents: Number.MAX_SAFE_INTEGER }]
  assert.deepEqual(data(['fund-a', 'fund-b']).points, [])
  assert.match(data(['fund-a', 'fund-b']).empty, /exceed the supported/)
})

test('multiple invested selections aggregate selected cash flows and disclose missing records', () => {
  const transactions = {
    status: 'available',
    transactions: [
      { isin: 'a', date: '2026-01-01', operation: 'buy', amountCents: 101 },
      { isin: 'b', date: '2026-01-01', operation: 'buy', amountCents: 202 },
      { isin: 'c', date: '2026-01-02', operation: 'buy', amountCents: 9000 },
      { isin: 'b', date: '2026-02-01', operation: 'sell', amountCents: 50 },
    ],
  }
  const data = selectedChartData(null, [], transactions, ['a', 'b', 'd'], 'invested')
  assert.deepEqual(data.points, [
    { date: '2026-01-01', valueCents: 303 }, { date: '2026-02-01', valueCents: 253 },
  ])
  assert.match(data.coverage, /3 transactions/)
  assert.match(data.coverage, /1 selected fund\(s\) have no CSV records/)
  assert.equal(data.title, 'Net invested cash (CSV)')
})

test('deselecting every fund gives a selection prompt in either chart mode', () => {
  for (const metric of ['portfolio', 'invested']) {
    const data = selectedChartData({ points: [{ date: '2026-01-01', valueCents: 100 }] }, [], null, [], metric)
    assert.deepEqual(data.points, [])
    assert.match(data.empty, /Select at least one fund/)
    assert.equal(data.title, metric === 'portfolio' ? 'Historical value of current holdings' : 'Net invested cash (CSV)')
    assert.equal(data.coverage, 'No funds selected.')
  }
})

test('selected cash flow sums retain integer precision and report unsupported balances', () => {
  const transactions = {
    status: 'available',
    transactions: [
      { isin: 'a', date: '2026-01-01', operation: 'buy', amountCents: Number.MAX_SAFE_INTEGER },
      { isin: 'a', date: '2026-01-01', operation: 'buy', amountCents: 2 },
      { isin: 'a', date: '2026-01-01', operation: 'sell', amountCents: Number.MAX_SAFE_INTEGER },
    ],
  }
  const data = () => selectedChartData(null, [], transactions, ['a'], 'invested')
  assert.deepEqual(data().points, [{ date: '2026-01-01', valueCents: 2 }])
  transactions.transactions.pop()
  assert.deepEqual(data().points, [])
  assert.match(data().empty, /exceed the supported/)
})

test('historical values use current fractional units and the same per-holding rounding', () => {
  const history = portfolioHistory([
    fund('a', '1.882', [{ date: '2026-09-23', close: 123.45 }, { date: '2026-09-22', close: 100 }]),
    fund('b', '2.993', [{ date: '2026-09-22', close: 200 }, { date: '2026-09-23', close: 67.89 }]),
    fund('c', '13.874', [{ date: '2026-09-23', close: 10.25 }, { date: '2026-09-22', close: 50 }]),
  ])
  assert.deepEqual(history, {
    partial: false,
    includedIsins: ['a', 'b', 'c'],
    points: [
      { date: '2026-09-22', valueCents: 148050 },
      { date: '2026-09-23', valueCents: 57773 },
    ],
  })
})

test('historical series uses only shared dates without carrying prices forward or changing composition', () => {
  const history = portfolioHistory([
    fund('a', '1', [{ date: '2026-09-21', close: 10 }, { date: '2026-09-23', close: 30 }]),
    fund('b', '1', [{ date: '2026-09-21', close: 20 }, { date: '2026-09-22', close: 40 }]),
  ])
  assert.deepEqual(history.points, [{ date: '2026-09-21', valueCents: 3000 }])
  assert.equal(history.partial, false)
})

test('unavailable funds are excluded for every date and history is labeled partial', () => {
  const history = portfolioHistory([
    fund('a', '2', [{ date: '2026-09-21', close: 10 }, { date: '2026-09-23', close: 30 }]),
    { isin: 'b', status: 'unavailable' },
  ])
  assert.equal(history.partial, true)
  assert.deepEqual(history.includedIsins, ['a'])
  assert.deepEqual(history.points, [
    { date: '2026-09-21', valueCents: 2000 },
    { date: '2026-09-23', valueCents: 6000 },
  ])
})

test('missing or invalid historical closes are omitted instead of being valued at zero', () => {
  const rows = [undefined, null, 0, -1, '10', Infinity, 1e100, 10]
    .map((close, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}`, close }))
  assert.deepEqual(portfolioHistory([fund('a', '1', rows)]).points, [
    { date: '2026-09-08', valueCents: 1000 },
  ])
})

test('no available funds or no common dates produce an empty history, not an invented line', () => {
  assert.deepEqual(portfolioHistory([{ isin: 'a', status: 'unavailable' }]), {
    partial: true, includedIsins: [], points: [],
  })
  assert.deepEqual(portfolioHistory([
    fund('a', '1', [{ date: '2026-09-21', close: 10 }]),
    fund('b', '1', [{ date: '2026-09-22', close: 20 }]),
  ]).points, [])
})

test('zero units and flat price series remain valid', () => {
  assert.deepEqual(portfolioHistory([fund('a', '0', [{ date: '2026-09-21', close: 10 }])]).points, [
    { date: '2026-09-21', valueCents: 0 },
  ])
  assert.deepEqual(portfolioHistory([
    fund('a', '1', [{ date: '2026-09-21', close: .005 }]),
    fund('b', '1', [{ date: '2026-09-21', close: .005 }]),
  ]).points, [{ date: '2026-09-21', valueCents: 2 }])
})

test('chart periods are relative to the latest observation, not today', () => {
  const points = ['2023-06-20', '2024-06-19', '2024-06-20', '2025-03-20', '2025-05-20', '2025-06-20']
    .map(date => ({ date, valueCents: 100 }))
  assert.deepEqual(periodPoints(points, 'ALL'), points)
  assert.deepEqual(periodPoints(points, '1Y'), points.slice(2))
  assert.deepEqual(periodPoints(points, '3M'), points.slice(3))
  assert.deepEqual(periodPoints(points, '1M'), points.slice(4))
  assert.deepEqual(periodPoints([], '1Y'), [])
})

test('calendar periods clamp month ends and handle leap years', () => {
  const points = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31']
    .map(date => ({ date, valueCents: 100 }))
  assert.deepEqual(periodPoints(points, '1M'), points.slice(1))
  const yearly = ['2023-02-27', '2023-02-28', '2024-02-29'].map(date => ({ date, valueCents: 100 }))
  assert.deepEqual(periodPoints(yearly, '1Y'), yearly.slice(1))
})
