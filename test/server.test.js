import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server.js'
import { PortfolioService } from '../lib/portfolio.js'
import { holdings as configuredHoldings } from '../holdings.js'

const holdings = configuredHoldings.filter(holding => (holding.provider ?? 'eodhd') === 'eodhd')

async function runningApp(t, service, transactionLoader = async () => ({ status: 'missing', message: 'No fixture' })) {
  const server = createApp({ service, transactionLoader })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return `http://127.0.0.1:${server.address().port}`
}

test('local HTTP API returns complete missing-key states and the dashboard assets', async t => {
  const service = new PortfolioService({ holdings, apiKey: '' })
  const origin = await runningApp(t, service)
  const response = await fetch(`${origin}/api/portfolio`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json()
  assert.equal(data.funds.length, 3)
  assert.equal(data.partial, true)
  assert.ok(data.funds.every(fund => fund.code === 'missing_key'))
  assert.deepEqual(data.history, { partial: true, includedIsins: [], points: [] })
  for (const [path, contentType] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/chart.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const asset = await fetch(`${origin}${path}`)
    assert.equal(asset.status, 200)
    assert.ok(asset.headers.get('content-type').startsWith(contentType))
    assert.match(asset.headers.get('content-security-policy'), /connect-src 'self'/)
    const text = await asset.text()
    assert.ok(text.length > 0)
    assert.equal(text.includes('api_token'), false)
  }
})

test('server never serves configuration, environment, or repository files', async t => {
  const origin = await runningApp(t, new PortfolioService({ holdings, apiKey: '' }))
  for (const path of ['/.env', '/.env.example', '/holdings.js', '/server.js', '/package.json', '/.git/config', '/%2e%2e/.env', '/fund_transactions_2019-2025.csv']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 404, path)
  }
  assert.equal((await fetch(`${origin}/api/portfolio`, { method: 'POST' })).status, 405)
})

test('transactions load independently of EODHD with no provider requests', async t => {
  let reads = 0
  const origin = await runningApp(t, {
    getPortfolio: () => assert.fail('CSV endpoint must not request prices'),
  }, async () => {
    reads++
    return { status: 'available', count: reads, netInvestedCents: reads * 100 }
  })
  const response = await fetch(`${origin}/api/transactions`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).netInvestedCents, 100)
  assert.equal((await (await fetch(`${origin}/api/transactions`)).json()).netInvestedCents, 200)
})

test('invalid CSV is reported explicitly without breaking the portfolio endpoint', async t => {
  const origin = await runningApp(t, new PortfolioService({ holdings, apiKey: '' }), async () => ({
    status: 'invalid', message: 'Invalid CSV record 3.',
  }))
  assert.equal((await (await fetch(`${origin}/api/transactions`)).json()).status, 'invalid')
  assert.equal((await (await fetch(`${origin}/api/portfolio`)).json()).funds.length, 3)
})

test('refresh flag reaches the service and no other query parameters are forwarded', async t => {
  const flags = []
  const origin = await runningApp(t, {
    getPortfolio: options => { flags.push(options); return { funds: [] } },
  })
  await fetch(`${origin}/api/portfolio`)
  await fetch(`${origin}/api/portfolio?refresh=1&api_token=untrusted`)
  assert.deepEqual(flags, [{ refresh: false }, { refresh: true }])
})

test('unexpected failures use a fixed safe error in both response and logs', async t => {
  const secret = 'very-private-test-token'
  const logs = []
  t.mock.method(console, 'error', message => logs.push(message))
  const origin = await runningApp(t, {
    getPortfolio: () => { throw new Error(`Upstream URL contains ${secret}`) },
  })
  const response = await fetch(`${origin}/api/portfolio`)
  assert.equal(response.status, 500)
  assert.equal((await response.text()).includes(secret), false)
  assert.equal(logs.join('').includes(secret), false)
  assert.equal(logs.length, 1)
})
