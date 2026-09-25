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
  setAttribute(name, value) {
    this.attributes.set(name, value)
    if (name === 'viewBox') {
      const [, , width, height] = value.split(' ').map(Number)
      this.viewBox = { baseVal: { width, height } }
    }
  }
  removeAttribute(name) { this.attributes.delete(name) }
  getComputedTextLength() { return this.attributes.get('textLength') ?? this.textContent.length * 7 }
  contains(element) { return this === element || this.children.some(child => child.contains(element)) }
  focus() { document.activeElement = this }
  matches(selector) { return selector === 'input[type="checkbox"]' && this.tag === 'input' }
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

async function dashboard(t, { desktop = true } = {}) {
  const original = new Map(['document', 'fetch', 'ResizeObserver', 'matchMedia', 'DOMPoint'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
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
  get('chart-fund-selector').append(get('chart-fund-summary'), get('chart-all-funds'), get('chart-funds'))
  get('chart-fund-selector').open = true
  get('history-chart').clientWidth = 266
  get('history-chart').clientHeight = 340
  get('history-chart').getScreenCTM = () => ({ inverse() {} })
  globalThis.DOMPoint = class {
    constructor(x, y) { this.x = x; this.y = y }
    matrixTransform() { return this }
  }
  const metricButtons = ['portfolio', 'invested'].map(metric => Object.assign(new Element('button'), { dataset: { metric } }))
  const periodButtons = ['1M', '3M', '1Y', 'ALL'].map(period => Object.assign(new Element('button'), { dataset: { period } }))
  globalThis.document = {
    getElementById: get,
    querySelectorAll: selector => selector === '[data-metric]' ? metricButtons : periodButtons,
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
  }
  const media = new Element()
  media.matches = desktop
  globalThis.matchMedia = query => {
    assert.equal(query, '(min-width: 981px)')
    return media
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
  return { get, respond, card, requests, media, metricButtons, periodButtons }
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
  assert.equal(get('chart-title').textContent, 'Historical value of current holdings')
  assert.equal(card(0).querySelector('.fund-allocation').value, .1)
  assert.equal(card(0).querySelector('.fund-allocation').hidden, false)
  assert.equal(card(0).querySelector('.fund-allocation').attributes.get('aria-valuetext'), '10 %')

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
  assert.equal(card(0).querySelector('.fund-allocation').value, 1)
  assert.match(card(0).querySelector('.fund-allocation').attributes.get('aria-label'), /priced subtotal share/)
  assert.equal(card(1).querySelector('.fund-allocation').hidden, true)
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
  for (let index = 0; index < 4; index++) assert.equal(card(index).querySelector('.fund-allocation').hidden, true)
  assert.equal(get('total').textContent, '0,00 €')
  assert.match(get('transactions-scope').textContent, /CSV coverage unavailable/)
  get('refresh').listeners.get('click')()
  await respond('/api/portfolio?refresh=1', holdings({ unavailable: true }))
  await respond('/api/transactions', { status: 'invalid', message: 'Invalid CSV.' })
  assert.equal(get('total').textContent, '—')
  assert.equal(get('latest-price-date').textContent, 'Unavailable')
  assert.match(get('coverage').textContent, /not a zero-value portfolio/)
  assert.equal(card(0).querySelector('.fund-share').textContent, 'Unavailable')
  assert.equal(card(0).querySelector('.fund-allocation').hidden, true)
})

test('valuation defaults to every observation, retains controls on refresh, and never substitutes CSV history', async t => {
  const { get, respond, metricButtons, periodButtons } = await dashboard(t)
  const data = holdings()
  data.history.points = [{ date: '2020-01-02', valueCents: 1000 }, { date: '2026-09-24', valueCents: 10000 }]
  const csv = ledger()
  csv.points = [{ date: '2025-01-02', valueCents: 300 }]
  await respond('/api/transactions', csv)
  assert.equal(get('chart-content').hidden, true)
  assert.match(get('chart-empty').textContent, /history unavailable/)
  await respond('/api/portfolio', data)
  assert.match(get('chart-summary').textContent, /02.01.2020.*24.09.2026.*2 observations/)
  assert.equal(get('history-chart').querySelectorAll('circle').length, 3)
  periodButtons[0].listeners.get('click')()
  assert.match(get('chart-summary').textContent, /1 observations/)
  metricButtons[1].listeners.get('click')()
  assert.equal(get('chart-title').textContent, 'Net invested cash (CSV)')
  get('refresh').listeners.get('click')()
  await respond('/api/transactions', csv)
  await respond('/api/portfolio?refresh=1', data)
  assert.equal(get('chart-title').textContent, 'Net invested cash (CSV)')
  assert.equal(periodButtons[0].attributes.get('aria-pressed'), 'true')
})

test('mobile fund disclosure stays collapsed across renders and preserves expanded preference on resize', async t => {
  const { get, respond, media } = await dashboard(t, { desktop: false })
  const selector = get('chart-fund-selector')
  assert.equal(selector.open, false)
  await respond('/api/portfolio', holdings())
  await respond('/api/transactions', ledger())
  assert.equal(selector.open, false)
  assert.equal(get('chart-selection-count').textContent, '4 / 4')
  media.matches = true
  media.listeners.get('change')()
  assert.equal(selector.open, true)
  let prevented = false
  get('chart-fund-summary').listeners.get('click')({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  media.matches = false
  media.listeners.get('change')()
  assert.equal(selector.open, false)
  selector.open = true
  selector.listeners.get('toggle')()
  media.matches = true
  media.listeners.get('change')()
  media.matches = false
  media.listeners.get('change')()
  assert.equal(selector.open, true)
})

test('desktop selection remains visible and resizing never hides a focused checkbox', async t => {
  const { get, respond, media } = await dashboard(t)
  assert.equal(get('chart-fund-selector').open, true)
  await respond('/api/portfolio', holdings())
  await respond('/api/transactions', ledger())
  get('chart-all-funds').focus()
  media.matches = false
  media.listeners.get('change')()
  assert.equal(get('chart-fund-selector').open, true)
  const boxes = get('chart-funds').querySelectorAll('input')
  boxes[0].checked = false
  get('chart-funds').listeners.get('change')({ target: boxes[0] })
  assert.equal(get('chart-all-funds').indeterminate, true)
  assert.equal(get('chart-selection-count').textContent, '3 / 4')
  get('refresh').listeners.get('click')()
  await respond('/api/portfolio?refresh=1', holdings())
  await respond('/api/transactions', ledger())
  assert.equal(get('chart-funds').querySelectorAll('input')[0].checked, false)
  assert.equal(get('chart-all-funds').indeterminate, true)
  assert.equal(get('chart-fund-selector').open, true)
})

test('narrow charts use short date ticks and bound tooltips without changing exact inspection values', async t => {
  const { get, respond } = await dashboard(t)
  const data = holdings()
  data.history.points = [
    { date: '2020-01-02', valueCents: 100_000_000 },
    { date: '2026-09-24', valueCents: 200_000_000 },
  ]
  await respond('/api/portfolio', data)
  await respond('/api/transactions', ledger())
  const svg = get('history-chart')
  const dates = svg.children.filter(child => child.tag === 'text' && child.attributes.get('y') === 328)
  assert.deepEqual(dates.map(child => child.textContent), ['02.01.', '24.09.'])
  svg.listeners.get('focus')()
  assert.equal(get('chart-announcement').textContent, '24.09.2026 · 2.000.000,00 €')
  const tooltip = svg.children.find(child => child.attributes.get('class') === 'chart-tooltip')
  const box = tooltip.children[0]
  const [x, y] = tooltip.attributes.get('transform').match(/[-\d.]+/g).map(Number)
  assert.ok(x >= 0 && x + box.attributes.get('width') <= 266)
  assert.ok(y >= 0 && y + box.attributes.get('height') <= 340)
})

test('a zero-value holding has an honest zero meter when the priced total is positive', async t => {
  const { respond, card } = await dashboard(t)
  const data = holdings()
  data.totalCents -= data.funds[0].valueCents
  data.funds[0].valueCents = 0
  await respond('/api/portfolio', data)
  await respond('/api/transactions', ledger())
  assert.equal(card(0).querySelector('.fund-allocation').value, 0)
  assert.equal(card(0).querySelector('.fund-allocation').hidden, false)
  assert.equal(card(0).querySelector('.fund-allocation').attributes.get('aria-valuetext'), '0 %')
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

test('chart readout follows the exact tooltip observation for pointer, touch, and keyboard', async t => {
  const { get, respond, metricButtons, periodButtons } = await dashboard(t)
  const data = holdings()
  data.history.points = [
    { date: '2020-01-02', valueCents: 1000 },
    { date: '2026-09-01', valueCents: 0 },
    { date: '2026-09-24', valueCents: 12345 },
  ]
  const csv = ledger()
  csv.points = [
    { date: '2025-01-02', valueCents: -200 },
    { date: '2025-02-28', valueCents: 300 },
  ]
  await respond('/api/portfolio', data)
  await respond('/api/transactions', csv)
  const svg = get('history-chart')
  const readout = (amount, date) => {
    assert.equal(get('chart-current-value').textContent, amount)
    assert.equal(get('chart-current-date').textContent, `Observation · ${date}`)
  }
  const matchesTooltip = () => {
    const tooltip = svg.children.find(child => child.attributes.get('class') === 'chart-tooltip')
    readout(tooltip.children[2].textContent, tooltip.children[1].textContent)
  }
  const key = key => svg.listeners.get('keydown')({ key, preventDefault() {} })
  readout('123,45 €', '24.09.2026')
  assert.equal(get('chart-current-label').textContent, 'Selected holdings value at observation date')
  svg.listeners.get('pointermove')({ clientX: 84, clientY: 100 })
  readout('10,00 €', '02.01.2020')
  matchesTooltip()
  assert.equal(get('chart-announcement').textContent, '', 'Pointer does not add live announcements')
  svg.listeners.get('pointerleave')()
  readout('10,00 €', '02.01.2020')
  svg.listeners.get('pointerdown')({ clientX: 254, clientY: 100, pointerType: 'touch' })
  readout('123,45 €', '24.09.2026')
  matchesTooltip()
  key('ArrowLeft')
  readout('0,00 €', '01.09.2026')
  matchesTooltip()
  key('Home')
  matchesTooltip()
  key('Escape')
  readout('10,00 €', '02.01.2020')
  periodButtons[0].listeners.get('click')()
  readout('123,45 €', '24.09.2026')
  key('Home')
  readout('0,00 €', '01.09.2026')
  periodButtons[3].listeners.get('click')()
  readout('123,45 €', '24.09.2026')
  metricButtons[1].listeners.get('click')()
  readout('3,00 €', '28.02.2025')
  assert.equal(get('chart-current-label').textContent, 'Recorded net invested · selected funds')
  // A step chart uses the preceding observation even when the next is nearer.
  svg.listeners.get('pointermove')({ clientX: 230, clientY: 100 })
  readout('-2,00 €', '02.01.2025')
  matchesTooltip()
  key('End')
  readout('3,00 €', '28.02.2025')
  matchesTooltip()
  key('Home')
  get('refresh').listeners.get('click')()
  await respond('/api/portfolio?refresh=1', data)
  await respond('/api/transactions', csv)
  readout('3,00 €', '28.02.2025')
  metricButtons[0].listeners.get('click')()
  readout('123,45 €', '24.09.2026')
})

test('chart readout sums selected funds and clears stale values for empty selections and data', async t => {
  const { get, respond, metricButtons } = await dashboard(t)
  const data = holdings()
  data.funds[0].valueHistory = [
    { date: '2026-09-01', valueCents: 100 },
    { date: '2026-09-24', valueCents: 200 },
  ]
  data.funds[1].valueHistory = [
    { date: '2026-09-01', valueCents: 300 },
    { date: '2026-09-24', valueCents: 500 },
  ]
  data.history.points = [{ date: '2026-09-24', valueCents: 700 }]
  const csv = ledger()
  csv.points = [{ date: '2025-01-02', valueCents: 300 }]
  await respond('/api/portfolio', data)
  await respond('/api/transactions', csv)
  const empty = () => {
    assert.equal(get('chart-current-value').textContent, '—')
    assert.equal(get('chart-current-date').textContent, 'No observation')
  }
  get('chart-all-funds').checked = false
  get('chart-all-funds').listeners.get('change')()
  empty()
  const boxes = get('chart-funds').querySelectorAll('input')
  const pick = index => {
    boxes[index].checked = true
    get('chart-funds').listeners.get('change')({ target: boxes[index] })
  }
  pick(0)
  assert.equal(get('chart-current-value').textContent, '2,00 €')
  get('history-chart').listeners.get('keydown')({ key: 'Home', preventDefault() {} })
  assert.equal(get('chart-current-value').textContent, '1,00 €')
  pick(1)
  assert.equal(get('chart-current-value').textContent, '7,00 €')
  assert.equal(get('chart-current-date').textContent, 'Observation · 24.09.2026')
  metricButtons[1].listeners.get('click')()
  assert.equal(get('chart-current-value').textContent, '2,00 €')
  assert.equal(get('chart-current-date').textContent, 'Observation · 02.01.2025')
  get('refresh').listeners.get('click')()
  await respond('/api/portfolio?refresh=1', holdings())
  await respond('/api/transactions', { status: 'missing', message: 'CSV not found.' })
  empty()
  metricButtons[0].listeners.get('click')()
  empty()
})
