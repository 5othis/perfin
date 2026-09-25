import test from 'node:test'
import assert from 'node:assert/strict'

class Element {
  constructor(tag = 'div') {
    this.tag = tag
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.selectors = new Map()
    this.textContent = ''
    this.classList = { toggle() {} }
  }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  setAttribute(name, value) { this.attributes.set(name, value) }
  addEventListener(name, listener) { this.listeners.set(name, listener) }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element())
    return this.selectors.get(selector)
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.tag === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))
let instance = 0

async function dashboard(t) {
  const original = new Map(['document', 'fetch', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const elements = new Map()
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }
  get('fund-template').content = { cloneNode: () => new Element() }
  globalThis.document = {
    getElementById: get,
    querySelectorAll: () => [],
    createElement: tag => new Element(tag),
  }
  globalThis.ResizeObserver = class { observe() {} }
  const requests = []
  globalThis.fetch = url => new Promise((resolve, reject) => requests.push({ url, resolve, reject }))
  await import(`../public/app.js?dashboard-test=${instance++}`)
  const respond = async (url, data) => {
    const request = requests.find(request => request.url === url && !request.finished)
    assert.ok(request, `Expected pending request for ${url}`)
    request.finished = true
    request.resolve({ ok: true, json: async () => data })
    await settle()
  }
  const card = index => get('funds').children[index].querySelector('article')
  return { get, respond, card, requests }
}

function holdings({ partial = false, zero = false, unavailable = false } = {}) {
  const funds = Array.from({ length: 4 }, (_, index) => ({
    isin: `test-${index}`, name: `Test fund ${index}`, units: zero ? '0' : '1',
    status: unavailable || (partial && index > 0) ? 'unavailable' : 'available',
    valueCents: zero ? 0 : (index + 1) * 1000,
    price: (index + 1) * 10, priceDate: `2026-09-${21 + index}`,
    cached: index === 0, resolved: true, valueHistory: [],
  }))
  const available = funds.filter(fund => fund.status === 'available')
  return {
    funds, totalCents: available.reduce((sum, fund) => sum + fund.valueCents, 0),
    availableCount: available.length, partial: available.length < funds.length,
    totalLabel: available.length < funds.length ? 'Partial total' : 'Portfolio value',
    lastFetchedAt: '2026-09-25T09:00:00Z', history: { points: [], partial },
  }
}

function ledger(count = 3) {
  return {
    status: 'available', count, firstDate: '2025-01-02', lastDate: '2025-01-02',
    purchasesCents: count * 100, salesCents: 0, netInvestedCents: count * 100, points: [],
    byFund: Array.from({ length: count }, (_, index) => ({
      isin: `test-${index}`, name: `Test fund ${index}`, purchasesCents: 100, salesCents: 0, netInvestedCents: 100,
    })),
    transactions: Array.from({ length: count }, (_, index) => ({
      isin: `test-${index}`, fund: `Test fund ${index}`, date: '2025-01-02', operation: 'buy', amountCents: 100,
    })),
  }
}

test('CSV coverage waits for holdings and updates dynamically when the CSV arrives first', async t => {
  const { get, respond, card } = await dashboard(t)
  await respond('/api/transactions', ledger())
  assert.match(get('transactions-scope').textContent, /coverage is not yet available/)
  await respond('/api/portfolio', holdings())
  assert.match(get('transactions-scope').textContent, /3 of 4 current funds/)
  assert.match(get('transactions-scope').textContent, /unknown invested amounts, not zero/)
  assert.equal(get('fund-count').textContent, 4)
  assert.equal(get('latest-price-date').textContent, '24.09.2026')
  assert.equal(card(0).querySelector('.fund-share').textContent, '10 %')
  assert.equal(card(0).querySelector('.fund-share-label').textContent, 'Portfolio share')
  assert.equal(card(0).querySelector('.status-badge').textContent, 'Cached EOD price')
  assert.equal(get('transaction-rows').children[0].children[0].textContent, '02.01.2025')
  assert.equal(get('chart-title').textContent, 'Net invested cash (CSV)')

  get('refresh').listeners.get('click')()
  await respond('/api/transactions', ledger(2))
  assert.match(get('transactions-scope').textContent, /2 of 4 current funds/)
  await respond('/api/portfolio?refresh=1', holdings())
  assert.match(get('transactions-scope').textContent, /2 of 4 current funds/)
})

test('partial allocation uses the priced subtotal and CSV coverage works with holdings first', async t => {
  const { get, respond, card } = await dashboard(t)
  await respond('/api/portfolio', holdings({ partial: true }))
  assert.match(get('transactions-scope').textContent, /Checking CSV coverage/)
  assert.equal(card(0).querySelector('.fund-share').textContent, '100 %')
  assert.equal(card(0).querySelector('.fund-share-label').textContent, 'Priced subtotal share')
  assert.equal(card(1).querySelector('.fund-share').textContent, 'Unavailable')
  assert.equal(get('latest-price-date').textContent, '21.09.2026')
  assert.match(get('allocation-note').textContent, /priced subtotal/)
  await respond('/api/transactions', ledger())
  assert.match(get('transactions-scope').textContent, /3 of 4 current funds/)
})

test('zero and unavailable totals never produce bogus allocation percentages', async t => {
  const { get, respond, card } = await dashboard(t)
  await respond('/api/portfolio', holdings({ zero: true }))
  await respond('/api/transactions', { status: 'missing', message: 'CSV not found.' })
  for (let index = 0; index < 4; index++) assert.equal(card(index).querySelector('.fund-share').textContent, 'Unavailable')
  assert.equal(get('total').textContent, '0,00 €')
  assert.match(get('transactions-scope').textContent, /CSV coverage unavailable/)
  get('refresh').listeners.get('click')()
  await respond('/api/portfolio?refresh=1', holdings({ unavailable: true }))
  await respond('/api/transactions', { status: 'invalid', message: 'Invalid CSV.' })
  assert.equal(get('total').textContent, '—')
  assert.equal(get('latest-price-date').textContent, 'Unavailable')
  assert.match(get('coverage').textContent, /not a zero-value portfolio/)
  assert.equal(card(0).querySelector('.fund-share').textContent, 'Unavailable')
})

test('a failed refresh retains the snapshot and explicitly warns that it may be outdated', async t => {
  const { get, respond, requests } = await dashboard(t)
  await respond('/api/portfolio', holdings())
  await respond('/api/transactions', ledger())
  const previousTotal = get('total').textContent
  get('refresh').listeners.get('click')()
  requests.find(request => request.url === '/api/portfolio?refresh=1').reject(new Error('Offline'))
  await respond('/api/transactions', ledger())
  assert.equal(get('total').textContent, previousTotal)
  assert.equal(get('request-error').hidden, false)
  assert.match(get('request-error').textContent, /previous snapshot.*may be outdated/)
  assert.equal(get('refresh').disabled, false)
})
