import test from 'node:test'
import assert from 'node:assert/strict'
import { ErsteWebsiteSource, ERSTE_ISIN, ERSTE_PAGE, parseErstePrices, websiteDataUrl } from '../lib/erste.js'
import { ProviderError } from '../lib/provider-error.js'
import { PortfolioService } from '../lib/portfolio.js'
import { holdings } from '../holdings.js'

const websiteFund = holdings.find(holding => holding.provider === 'erste-website')
const NOW = Date.parse('2026-09-25T10:00:00Z')
const config = {
  fundTableStyle: 'historicFundPrices', apiIsinField: 'ISIN', api2ndLevel: 'PRICES',
  apiConfiguration: 'FUNDPRICES_HIST,FUNDPRICES_HIST_META',
  selectedFactSheet: { apiEndpoint: 'https://data.erste-am.com/gem/erste-am/GEM_FACTSHEET' },
  columns: ['DAT_STATISTIK', 'CURRENCY', 'NAV', 'ISSUE_PRICE'].map(fundTableApiField => ({ fundTableApiField })),
}
const html = settings => `<script type="application/gem+json">${JSON.stringify(settings)}</script>`
const page = html({ displayedIsin: 'SK3110000336' }) + html(config)
const row = (extra = {}) => ({ CURRENCY: 'EUR', DAT_STATISTIK: '24. 9. 2026', NAV: '0,123456', ISSUE_PRICE: '9,999999', ...extra })
const payload = (prices = [row()], isin = ERSTE_ISIN) => ({ FUNDPRICES_HIST: [{ ISIN: isin, PRICES: prices }] })
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers })

test('follows only the verified official page endpoint and uses the requested ISIN, not the page default', () => {
  const url = websiteDataUrl(page, ERSTE_ISIN)
  assert.equal(url.origin, 'https://data.erste-am.com')
  assert.equal(url.searchParams.get('ISIN'), ERSTE_ISIN)
  assert.equal(url.pathname, '/gem/erste-am/GEM_FACTSHEET;ddsSources=FUNDPRICES_HIST')
  assert.equal(url.searchParams.has('api_token'), false)
  for (const settings of [
    { ...config, selectedFactSheet: { apiEndpoint: 'https://example.org/other' } },
    { ...config, columns: [] }, { ...config, apiConfiguration: 42 },
    { ...config, apiIsinField: 'OTHER' }, { ...config, api2ndLevel: 'OTHER' },
  ]) assert.throws(() => websiteDataUrl(html(settings), ERSTE_ISIN), ProviderError)
  assert.throws(() => websiteDataUrl('<html>Changed website</html>', ERSTE_ISIN), ProviderError)
  assert.throws(() => websiteDataUrl(html(config) + html(config), ERSTE_ISIN), ProviderError)
  assert.throws(() => websiteDataUrl(page, 'SK3110000336'), ProviderError)
})

test('reads comma-decimal NAV without using issue price and excludes SKK history', () => {
  const result = parseErstePrices(payload([
    row(), row({ DAT_STATISTIK: '23. 9. 2026', NAV: '0,100001' }),
    row({ CURRENCY: 'SKK', DAT_STATISTIK: '1. 5. 2007', NAV: '1,000000' }),
  ]), ERSTE_ISIN, '2026-09-25')
  assert.equal(result.price, .123456)
  assert.equal(result.priceDate, '2026-09-24')
  assert.equal(result.history.length, 2)
  assert.ok(result.history.every(item => item.date.startsWith('2026')))
})

test('rejects mismatched or ambiguous ISIN, invalid latest NAV, missing currency and impossible dates', () => {
  for (const data of [
    {}, payload([], ERSTE_ISIN), payload([row()], 'SK3110000336'),
    { FUNDPRICES_HIST: [payload().FUNDPRICES_HIST[0], payload().FUNDPRICES_HIST[0]] },
    payload([row({ CURRENCY: 'USD' })]),
    payload([row({ CURRENCY: undefined })]),
    payload([row({ NAV: '-' })]), payload([row({ NAV: 0 })]),
    payload([row({ NAV: '-0,12' })]), payload([row({ NAV: '1,2,3' })]),
    payload([row({ DAT_STATISTIK: '31. 2. 2026' })]),
    payload([row({ DAT_STATISTIK: '26. 9. 2026' })]),
    payload([row({ DAT_STATISTIK: undefined })]),
    payload([row(), row({ NAV: '0,11' })]),
  ]) assert.throws(() => parseErstePrices(data, ERSTE_ISIN, '2026-09-25'), ProviderError)
})

test('does not replace invalid or non-EUR latest NAV with an older good price', () => {
  for (const latest of [row({ NAV: '-' }), row({ CURRENCY: 'SKK' })]) {
    assert.throws(() => parseErstePrices(payload([
      row({ DAT_STATISTIK: '23. 9. 2026' }), latest,
    ]), ERSTE_ISIN, '2026-09-25'), ProviderError)
  }
})

test('unusable older EUR NAVs remain missing observations, not zero values', () => {
  const result = parseErstePrices(payload([row(), row({ DAT_STATISTIK: '23. 9. 2026', NAV: '-' })]), ERSTE_ISIN, '2026-09-25')
  assert.equal(result.history.find(item => item.date === '2026-09-23').close, null)
  assert.equal(result.price, .123456)
})

test('website fund works without an EODHD key and is cached across refreshes', async () => {
  let now = NOW
  const calls = []
  const service = new PortfolioService({
    holdings, apiKey: '', now: () => now,
    fetchImpl: async (url, options) => {
      calls.push(String(url))
      assert.equal(new URL(url).searchParams.has('api_token'), false)
      assert.equal(options.headers['Accept-Language'], 'en-SK')
      assert.equal(options.redirect, 'error')
      return String(url) === ERSTE_PAGE ? new Response(page) : json(payload())
    },
  })
  const initial = await service.getPortfolio()
  assert.equal(initial.funds.length, 4)
  assert.ok(initial.funds.slice(0, 3).every(fund => fund.code === 'missing_key'))
  assert.equal(initial.funds[3].status, 'available')
  assert.equal(initial.funds[3].provider, 'erste-website')
  assert.equal(initial.funds[3].valueCents, 1188684)
  assert.equal(initial.totalCents, 1188684)
  assert.equal(initial.partial, true)
  assert.deepEqual(initial.history.includedIsins, [ERSTE_ISIN])
  assert.equal(calls.length, 2)
  now += 30_000
  const cached = await service.getPortfolio({ refresh: true })
  assert.equal(cached.funds[3].fetchedAt, initial.funds[3].fetchedAt)
  assert.equal(cached.funds[3].cached, true)
  assert.equal(calls.length, 2)
  now += 31_000
  await service.getPortfolio({ refresh: true })
  assert.equal(calls.length, 4)
})

function mixedFetch(ersteResponse, eodStatus = 200) {
  return async url => {
    const parsed = new URL(url)
    if (parsed.hostname === 'eodhd.com') {
      if (eodStatus !== 200) return json({}, eodStatus, { 'Retry-After': '120' })
      if (parsed.pathname.includes('/search/')) {
        const isin = decodeURIComponent(parsed.pathname.split('/').at(-1))
        return json([{ ISIN: isin, Currency: 'EUR', Type: 'Fund', Code: isin, Exchange: 'TEST' }])
      }
      return json([{ date: '2026-09-23', close: 100 }])
    }
    assert.equal(parsed.searchParams.has('api_token'), false)
    return ersteResponse(url)
  }
}

test('all four funds contribute to headline total and common-date portfolio history', async () => {
  const service = new PortfolioService({
    holdings, apiKey: 'synthetic-secret', now: () => NOW,
    fetchImpl: mixedFetch(url => String(url) === ERSTE_PAGE ? new Response(page) : json(payload([
      row(), row({ DAT_STATISTIK: '23. 9. 2026', NAV: '0,100000' }),
    ]))),
  })
  const data = await service.getPortfolio()
  assert.equal(data.availableCount, 4)
  assert.equal(data.totalCents, 1376174)
  assert.equal(data.partial, false)
  assert.deepEqual(data.history.points, [{ date: '2026-09-23', valueCents: 1150330 }])
  assert.equal(data.history.includedIsins.length, 4)
  assert.deepEqual(data.funds[3].valueHistory, [
    { date: '2026-09-23', valueCents: 962840 },
    { date: '2026-09-24', valueCents: 1188684 },
  ])
  assert.equal(JSON.stringify(data).includes('synthetic-secret'), false)
})

test('website failure leaves EODHD funds working without leaking response bodies', async () => {
  const service = new PortfolioService({
    holdings, apiKey: 'synthetic-secret', now: () => NOW,
    fetchImpl: mixedFetch(() => json({ message: 'synthetic-secret' }, 503)),
  })
  const data = await service.getPortfolio()
  assert.equal(data.availableCount, 3)
  assert.equal(data.funds[3].code, 'provider_error')
  assert.equal(data.totalCents, 187490)
  assert.equal(JSON.stringify(data).includes('synthetic-secret'), false)
})

test('provider rate limits remain independent in both directions', async () => {
  for (const eodLimited of [false, true]) {
    const service = new PortfolioService({
      holdings, apiKey: 'synthetic-secret', now: () => NOW,
      fetchImpl: mixedFetch(url => eodLimited
        ? String(url) === ERSTE_PAGE ? new Response(page) : json(payload())
        : json({}, 429, { 'Retry-After': '120' }), eodLimited ? 429 : 200),
    })
    const data = await service.getPortfolio()
    assert.equal(data.funds[3].status, eodLimited ? 'available' : 'unavailable')
    assert.equal(data.funds[0].status, eodLimited ? 'unavailable' : 'available')
    assert.equal(data.availableCount, eodLimited ? 1 : 3)
  }
})

test('website cooldown respects Retry-After and network or JSON failures are sanitized', async () => {
  let now = NOW
  let calls = 0
  const source = new ErsteWebsiteSource({
    now: () => now,
    fetchImpl: async () => { calls++; return json({}, 429, { 'Retry-After': '120' }) },
  })
  await assert.rejects(source.quote(ERSTE_ISIN), { code: 'rate_limit' })
  now += 61_000
  await assert.rejects(source.quote(ERSTE_ISIN), { code: 'rate_limit' })
  assert.equal(calls, 1)
  now += 61_000
  await assert.rejects(source.quote(ERSTE_ISIN), { code: 'rate_limit' })
  assert.equal(calls, 2)
  const service = new PortfolioService({
    holdings: [websiteFund], now: () => NOW,
    fetchImpl: async () => { throw new Error('private upstream error') },
  })
  const data = await service.getPortfolio()
  assert.equal(data.funds[0].code, 'network_error')
  assert.equal(JSON.stringify(data).includes('private upstream error'), false)
  const badJson = new ErsteWebsiteSource({
    now: () => NOW,
    fetchImpl: async url => new Response(String(url) === ERSTE_PAGE ? page : '<html>unreadable</html>'),
  })
  await assert.rejects(badJson.quote(ERSTE_ISIN), { code: 'invalid_response' })
})
