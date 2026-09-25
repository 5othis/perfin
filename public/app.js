import { createHistoryChart } from './chart.js'

const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const unitPrice = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 12,
})
const units = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 9 })
const timestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'medium',
})
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const byId = id => document.getElementById(id)
let loading = false
let hasData = false
const renderHistory = createHistoryChart()
let portfolio = null
let transactions = null

function updateChart() {
  renderHistory(portfolio?.history, portfolio?.funds ?? [], transactions)
}

function showTimestamp(value) {
  return value ? timestamp.format(new Date(value)) : 'Not yet fetched'
}

function render(data) {
  byId('total-label').textContent = data.totalLabel
  byId('total').textContent = money.format(data.totalCents / 100)
  byId('coverage').textContent = data.availableCount === 0
    ? `0 of ${data.funds.length} funds priced. No holdings are included; this is not a zero-value portfolio.`
    : `${data.availableCount} of ${data.funds.length} funds included${data.partial ? '. Unavailable holdings are excluded.' : ' in your portfolio value.'}`
  byId('last-fetched').textContent = showTimestamp(data.lastFetchedAt)
  byId('last-attempt').textContent = data.lastAttemptAt
    ? `Last update attempt: ${showTimestamp(data.lastAttemptAt)}`
    : 'No EODHD fetch attempted yet'
  byId('fund-count').textContent = data.funds.length
  const cards = data.funds.map(fund => {
    const fragment = byId('fund-template').content.cloneNode(true)
    const card = fragment.querySelector('article')
    const text = (selector, value) => { card.querySelector(selector).textContent = value }
    const available = fund.status === 'available'
    card.classList.toggle('is-unavailable', !available)
    const priceKind = fund.provider === 'erste-website' ? 'NAV' : 'EOD price'
    text('.status-badge', available ? (fund.cached ? `Cached ${priceKind}` : `${priceKind} available`) : 'Price unavailable')
    text('.fund-name', fund.name)
    text('.fund-isin', fund.isin)
    text('.fund-units', units.format(Number(fund.units)))
    text('.fund-price', available ? unitPrice.format(fund.price) : 'Unavailable')
    text('.fund-date', available ? date.format(new Date(`${fund.priceDate}T00:00:00Z`)) : 'Unavailable')
    text('.fund-message', fund.message ?? '')
    text('.fund-value', available ? money.format(fund.valueCents / 100) : 'Not included')
    text('.fund-symbol', fund.resolved ? `Verified EUR fund: ${fund.symbol ?? fund.isin}` : 'Exact ISIN / EUR match not yet verified')
    text('.fund-provider', `Source: ${fund.sourceName ?? 'EODHD'}`)
    const sourceLink = card.querySelector('.fund-source-link')
    sourceLink.hidden = fund.provider !== 'erste-website'
    if (fund.provider === 'erste-website') sourceLink.href = fund.sourceUrl
    text('.fund-fetched', available
      ? `Price fetched: ${showTimestamp(fund.fetchedAt)}`
      : fund.attemptedAt ? `Last attempt: ${showTimestamp(fund.attemptedAt)}` : 'No price fetch attempted')
    return fragment
  })
  byId('funds').replaceChildren(...cards)
  portfolio = data
  updateChart()
  hasData = true
}

function tableRow(values) {
  const row = document.createElement('tr')
  values.forEach(value => {
    const cell = document.createElement('td')
    cell.textContent = value
    row.append(cell)
  })
  return row
}

function renderTransactions(data) {
  transactions = data
  const available = data.status === 'available'
  byId('transactions-content').hidden = !available
  byId('transactions-status').textContent = available
    ? `${data.count} transactions from ${data.firstDate} to ${data.lastDate}. Source: fund_transactions_2019-2025.csv.`
    : data.message
  byId('transactions-scope').textContent = available
    ? `CSV covers ${data.byFund.length} funds only. Holdings without transaction records are not included in invested totals.`
    : ''
  byId('transactions-status').classList.toggle('error-banner', !available)
  byId('transaction-rows').replaceChildren()
  byId('investment-fund-rows').replaceChildren()
  if (available) {
    byId('purchases-total').textContent = money.format(data.purchasesCents / 100)
    byId('sales-total').textContent = money.format(data.salesCents / 100)
    byId('invested-total').textContent = money.format(data.netInvestedCents / 100)
    byId('transactions-count').textContent = `(${data.count})`
    byId('investment-fund-rows').replaceChildren(...data.byFund.map(fund => tableRow([
      fund.name, money.format(fund.purchasesCents / 100), money.format(fund.salesCents / 100),
      money.format(fund.netInvestedCents / 100),
    ])))
    byId('transaction-rows').replaceChildren(...[...data.transactions].reverse().map(transaction => {
      const row = tableRow([
        transaction.date, transaction.fund, transaction.operation === 'buy' ? 'Buy' : 'Sell',
        money.format(transaction.amountCents / 100),
      ])
      const isin = document.createElement('span')
      isin.className = 'transaction-isin'
      isin.textContent = transaction.isin
      row.children[1].append(isin)
      return row
    }))
  }
  updateChart()
}

async function loadTransactions() {
  try {
    const response = await fetch('/api/transactions', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Transaction request failed')
    const data = await response.json()
    if (!['available', 'missing', 'invalid', 'unavailable'].includes(data.status)) throw new Error('Invalid transaction response')
    renderTransactions(data)
  } catch {
    renderTransactions({
      status: 'unavailable',
      message: 'Could not load the transaction CSV. Check the local server and restart it if you just updated the app, then Refresh.',
    })
  }
}

async function loadPortfolio(refresh) {
  try {
    const response = await fetch(refresh ? '/api/portfolio?refresh=1' : '/api/portfolio', {
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok) throw new Error('Portfolio request failed')
    const data = await response.json()
    if (!Array.isArray(data.funds) || !Number.isSafeInteger(data.totalCents)) {
      throw new Error('Invalid portfolio response')
    }
    render(data)
    byId('update-status').textContent = `Portfolio updated. ${data.availableCount} of ${data.funds.length} funds have prices.`
  } catch {
    byId('request-error').textContent = hasData
      ? 'Refresh failed. The previous snapshot is still displayed and may be outdated. Check that the local server is running, then try Refresh again.'
      : 'Could not load your portfolio. Check that the local server is running, then try Refresh again.'
    byId('request-error').hidden = false
    byId('update-status').textContent = 'Could not fetch portfolio data.'
    if (!hasData) {
      byId('total-label').textContent = 'Portfolio unavailable'
      byId('total').textContent = '--'
      byId('coverage').textContent = 'No valuation has been calculated.'
      byId('funds').replaceChildren()
    }
  }
}

async function load(refresh = false) {
  if (loading) return
  loading = true
  byId('refresh').disabled = true
  byId('refresh-label').textContent = refresh ? 'Refreshing...' : 'Loading...'
  byId('summary').setAttribute('aria-busy', 'true')
  byId('funds').setAttribute('aria-busy', 'true')
  byId('request-error').hidden = true
  byId('update-status').textContent = 'Fetching portfolio and transaction data.'
  try {
    await Promise.all([loadPortfolio(refresh), loadTransactions()])
  } finally {
    loading = false
    byId('refresh').disabled = false
    byId('refresh-label').textContent = 'Refresh'
    byId('summary').setAttribute('aria-busy', 'false')
    byId('funds').setAttribute('aria-busy', 'false')
  }
}

byId('refresh').addEventListener('click', () => load(true))
load()
