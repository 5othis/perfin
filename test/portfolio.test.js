import test from 'node:test'
import assert from 'node:assert/strict'
import { holdings as configuredHoldings } from '../holdings.js'
import { PortfolioService } from '../lib/portfolio.js'

const START = Date.parse('2026-09-24T12:00:00Z')
const holdings = configuredHoldings.filter(holding => (holding.provider ?? 'eodhd') === 'eodhd')
const TOKEN = 'test-secret-never-return'
const MINUTE = 60_000
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
})
const match = (index = 0, extra = {}) => ({
  Code: `TEST${index}`, Exchange: 'TEST', Type: 'Mutual Fund',
  ISIN: holdings[index].isin, Currency: 'EUR', isPrimary: true, ...extra,
})
const bars = (close = 100) => [
  { date: '2026-09-23', close, adjusted_close: 0.01 },
  { date: '2026-09-22', close: 99 },
]

function harness(handler, configuredHoldings = [holdings[0]], apiKey = TOKEN) {
  let time = START
  const calls = []
  const service = new PortfolioService({
    holdings: configuredHoldings,
    apiKey,
    now: () => time,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      assert.equal(parsed.origin, 'https://eodhd.com')
      assert.equal(parsed.searchParams.get('api_token'), TOKEN)
      assert.equal(options.redirect, 'error')
      calls.push(parsed)
      return handler(parsed, calls.length)
    },
  })
  return { service, calls, advance: milliseconds => { time += milliseconds } }
}

test('without a key, all three funds remain visible and no external request is made', async () => {
  const { service, calls } = harness(() => assert.fail('Must not fetch'), holdings, '')
  const data = await service.getPortfolio()
  assert.equal(calls.length, 0)
  assert.equal(data.funds.length, 3)
  assert.equal(data.totalLabel, 'Partial total')
  assert.equal(data.lastFetchedAt, null)
  assert.equal(data.lastAttemptAt, null)
  assert.ok(data.funds.every(fund => !fund.resolved && fund.code === 'missing_key'))
})

test('resolve exact ISIN and EUR, then use latest raw close, not search or adjusted close', async () => {
  const { service, calls } = harness(url => url.pathname.includes('/search/')
    ? json([match(0, { previousClose: 999 })])
    : json([...bars(123.45)].reverse()))
  const data = await service.getPortfolio()
  const fund = data.funds[0]
  assert.equal(fund.symbol, 'TEST0.TEST')
  assert.equal(fund.resolved, true)
  assert.equal(fund.price, 123.45)
  assert.equal(fund.priceDate, '2026-09-23')
  assert.equal(fund.valueCents, 23233)
  assert.equal(fund.fetchedAt, new Date(START).toISOString())
  assert.equal(calls[0].pathname, `/api/search/${holdings[0].isin}`)
  assert.equal(calls[1].pathname, '/api/eod/TEST0.TEST')
  assert.equal(calls[1].searchParams.get('order'), 'd')
  assert.equal(calls[1].searchParams.has('limit'), false)
  assert.equal(calls[1].searchParams.has('from'), false)
  assert.equal(JSON.stringify(data).includes(TOKEN), false)
  assert.equal(fund.history, undefined)
  assert.deepEqual(fund.valueHistory, data.history.points)
  assert.deepEqual(data.history.points, [
    { date: '2026-09-22', valueCents: 18632 },
    { date: '2026-09-23', valueCents: 23233 },
  ])
})

test('never substitute another ISIN, non-EUR currency, or unverified instrument metadata', async t => {
  const variants = [
    { ISIN: 'LU0119195450' }, { ISIN: undefined }, { Currency: 'USD' },
    { Currency: undefined }, { Type: 'ETF' }, { Type: undefined },
    { Code: undefined }, { Code: '' }, { Code: '../../secret' },
    { Exchange: undefined }, { Exchange: '' },
  ]
  for (const extra of variants) {
    await t.test(JSON.stringify(extra), async () => {
      const { service, calls } = harness(() => json([match(0, extra)]))
      const data = await service.getPortfolio()
      assert.equal(data.funds[0].code, 'unverified_instrument')
      assert.equal(data.funds[0].resolved, false)
      assert.equal(data.funds[0].price, null)
      assert.equal(calls.length, 1)
    })
  }
})

test('a missing fund does not stop the other funds or contaminate the total', async () => {
  const { service } = harness(url => {
    if (url.pathname.includes('/search/')) {
      const index = holdings.findIndex(holding => url.pathname.endsWith(holding.isin))
      return json(index === 1 ? [] : [match(index)])
    }
    return json(bars(url.pathname.includes('TEST0') ? 123.45 : 10.25))
  }, holdings)
  const data = await service.getPortfolio()
  assert.equal(data.availableCount, 2)
  assert.equal(data.totalCents, 37454)
  assert.equal(data.totalLabel, 'Partial total')
  assert.equal(data.funds[1].code, 'unverified_instrument')
})

test('complete three-fund response has the exact total and individual valuation dates', async () => {
  const prices = [100, 200, 50]
  const dates = ['2026-09-23', '2026-09-22', '2026-09-21']
  const { service } = harness(url => {
    if (url.pathname.includes('/search/')) {
      const index = holdings.findIndex(holding => url.pathname.endsWith(holding.isin))
      return json([match(index)])
    }
    const index = Number(/TEST(\d)/.exec(url.pathname)[1])
    return json([{ date: dates[index], close: prices[index] }])
  }, holdings)
  const data = await service.getPortfolio()
  assert.deepEqual(data.funds.map(fund => fund.valueCents), [18820, 59860, 69370])
  assert.deepEqual(data.funds.map(fund => fund.priceDate), dates)
  assert.equal(data.totalCents, 148050)
  assert.equal(data.totalLabel, 'Total portfolio value')
  assert.equal(data.partial, false)
})

test('a price request failure leaves the other funds working and can recover on refresh', async () => {
  let failed = true
  const { service, advance } = harness(url => {
    if (url.pathname.includes('/search/')) {
      const index = holdings.findIndex(holding => url.pathname.endsWith(holding.isin))
      return json([match(index)])
    }
    if (failed && url.pathname.includes('TEST1')) throw new Error('Simulated network failure')
    return json(bars(100))
  }, holdings)
  const partial = await service.getPortfolio()
  assert.equal(partial.availableCount, 2)
  assert.equal(partial.funds[1].resolved, true)
  assert.equal(partial.funds[1].code, 'network_error')
  assert.equal(partial.totalCents, 157560)
  failed = false
  advance(2 * MINUTE)
  const complete = await service.getPortfolio({ refresh: true })
  assert.equal(complete.availableCount, 3)
  assert.equal(complete.totalCents, 187490)
})

test('verified alternate EUR listing of the same ISIN is tried when primary has no EOD data', async () => {
  const { service, calls } = harness(url => {
    if (url.pathname.includes('/search/')) {
      return json([match(0, { Code: 'SECOND', isPrimary: false }), match()])
    }
    return json(url.pathname.includes('SECOND') ? bars() : [])
  })
  const data = await service.getPortfolio()
  assert.equal(calls[1].pathname, '/api/eod/TEST0.TEST')
  assert.equal(data.funds[0].symbol, 'SECOND.TEST')
  assert.equal(data.funds[0].status, 'available')
})

test('old NAV dates are returned as-is, never relabeled as current prices', async () => {
  const { service } = harness(url => url.pathname.includes('/search/')
    ? json([match()]) : json([{ date: '2024-01-02', close: 10 }]))
  assert.equal((await service.getPortfolio()).funds[0].priceDate, '2024-01-02')
})

test('reject missing or invalid latest prices and dates rather than using older data', async t => {
  for (const latest of [
    { date: '2026-09-23' }, { date: '2026-09-23', close: null },
    { date: '2026-09-23', close: '123' }, { date: '2026-09-23', close: 0 },
    { date: '2026-09-23', close: -5 }, { date: '2026-09-23', close: 1e100 },
    { date: '2026-09-31', close: 100 }, { date: '2026-09-25', close: 100 },
    { date: 'yesterday', close: 100 }, { close: 100 },
  ]) {
    await t.test(JSON.stringify(latest), async () => {
      const { service } = harness(url => url.pathname.includes('/search/')
        ? json([match()]) : json([{ date: '2026-09-01', close: 99 }, latest]))
      const fund = (await service.getPortfolio()).funds[0]
      assert.equal(fund.status, 'unavailable')
      assert.equal(fund.code, 'invalid_price')
      assert.equal(fund.price, null)
    })
  }
})

test('empty EOD data preserves resolved symbol but excludes the holding', async () => {
  const { service } = harness(url => json(url.pathname.includes('/search/') ? [match()] : []))
  const fund = (await service.getPortfolio()).funds[0]
  assert.equal(fund.resolved, true)
  assert.equal(fund.symbol, 'TEST0.TEST')
  assert.equal(fund.code, 'no_prices')
  assert.equal(fund.valueCents, null)
})

test('cache, minimum refresh interval, and mapping TTL avoid unnecessary requests', async () => {
  const { service, calls, advance } = harness(url => json(url.pathname.includes('/search/') ? [match()] : bars()))
  const initial = await service.getPortfolio()
  advance(30_000)
  const cached = await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 2)
  assert.equal(cached.funds[0].cached, true)
  assert.equal(cached.funds[0].fetchedAt, initial.funds[0].fetchedAt)
  assert.deepEqual(cached.history, initial.history)
  assert.deepEqual(cached.funds[0].valueHistory, initial.funds[0].valueHistory)
  advance(31_000)
  await service.getPortfolio()
  assert.equal(calls.length, 2)
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 3)
  advance(60 * MINUTE + 1)
  await service.getPortfolio()
  assert.equal(calls.length, 4)
  advance(7 * 24 * 60 * MINUTE)
  await service.getPortfolio()
  assert.equal(calls.length, 6)
})

test('negative mappings are cached for six hours, even on refresh', async () => {
  const { service, calls, advance } = harness(() => json([]))
  await service.getPortfolio()
  advance(2 * MINUTE)
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 1)
  advance(6 * 60 * MINUTE)
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 2)
})

test('simultaneous requests share a single in-flight lookup and price request', async () => {
  const { service, calls } = harness(url => json(url.pathname.includes('/search/') ? [match()] : bars()))
  const results = await Promise.all([
    service.getPortfolio(), service.getPortfolio({ refresh: true }), service.getPortfolio(),
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(results[0], results[2])
})

test('HTTP failures are isolated per fund and never reflect secret response bodies', async t => {
  for (const [status, code] of [[401, 'access_denied'], [403, 'access_denied'], [404, 'not_found'], [500, 'provider_error']]) {
    await t.test(String(status), async () => {
      const { service } = harness(() => json({ error: TOKEN }, status))
      const data = await service.getPortfolio()
      assert.equal(data.funds[0].code, code)
      assert.equal(JSON.stringify(data).includes(TOKEN), false)
    })
  }
})

test('429 cooldown respects Retry-After and recovers after expiry', async () => {
  let limited = true
  const { service, calls, advance } = harness(url => limited
    ? json({ error: TOKEN }, 429, { 'Retry-After': '120' })
    : json(url.pathname.includes('/search/') ? [match()] : bars()))
  const first = await service.getPortfolio()
  assert.equal(first.funds[0].code, 'rate_limit')
  limited = false
  advance(61_000)
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 1)
  advance(61_000)
  assert.equal((await service.getPortfolio({ refresh: true })).funds[0].status, 'available')
  assert.equal(calls.length, 3)
})

test('429 supports HTTP-date Retry-After headers', async () => {
  const { service, calls, advance } = harness(() =>
    json({}, 429, { 'Retry-After': new Date(START + 5 * MINUTE).toUTCString() }))
  await service.getPortfolio()
  advance(2 * MINUTE)
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 1)
})

test('network errors and non-JSON responses cannot leak authenticated URLs', async t => {
  for (const handler of [
    () => { throw new Error(`Timeout for https://eodhd.com/api/search?api_token=${TOKEN}`) },
    () => new Response(`<html>${TOKEN}</html>`),
    () => json({ error: TOKEN }),
  ]) {
    await t.test('safe failure', async () => {
      const { service } = harness(handler)
      const data = await service.getPortfolio()
      assert.equal(data.funds[0].status, 'unavailable')
      assert.equal(JSON.stringify(data).includes(TOKEN), false)
    })
  }
})

test('a failed provider refresh does not silently retain a stale valuation', async () => {
  let failed = false
  const { service, advance } = harness(url => {
    if (failed) return json({}, 503)
    return json(url.pathname.includes('/search/') ? [match()] : bars())
  })
  assert.equal((await service.getPortfolio()).totalCents, 18820)
  failed = true
  advance(2 * MINUTE)
  const data = await service.getPortfolio({ refresh: true })
  assert.equal(data.funds[0].status, 'unavailable')
  assert.equal(data.funds[0].price, null)
  assert.equal(data.totalCents, 0)
  assert.equal(data.totalLabel, 'Partial total')
})
