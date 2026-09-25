import { ProviderError } from './provider-error.js'
import { validDate } from './price-date.js'

export const ERSTE_ISIN = 'SK3110000377'
export const ERSTE_PAGE = 'https://www.erste-am.sk/en/eamsk/historicalprices/fond-maximalizovanych-vynosov/SK3110000377'
const DATA_ENDPOINT = 'https://data.erste-am.com/gem/erste-am/GEM_FACTSHEET'
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = message => new ProviderError('invalid_response', message)

export function websiteDataUrl(html, isin) {
  if (isin !== ERSTE_ISIN) throw invalid('This Erste website source is configured for a different ISIN.')
  let config
  for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/gem\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let value
    try { value = JSON.parse(match[1]) } catch {
      throw invalid('The Erste website configuration could not be read. No price was used.')
    }
    if (isRecord(value) && value.fundTableStyle === 'historicFundPrices') {
      if (config) throw invalid('The Erste website returned ambiguous historical-price configuration.')
      config = value
    }
  }
  if (!config || config.selectedFactSheet?.apiEndpoint !== DATA_ENDPOINT ||
      config.apiIsinField !== 'ISIN' || config.api2ndLevel !== 'PRICES' ||
      typeof config.apiConfiguration !== 'string' || !config.apiConfiguration.split(',').includes('FUNDPRICES_HIST') ||
      !Array.isArray(config.columns) ||
      !['NAV', 'CURRENCY', 'DAT_STATISTIK'].every(field => config.columns.some(column => column?.fundTableApiField === field))) {
    throw invalid('The Erste website price table has changed or is unavailable. No price was used.')
  }
  // Follow the same public data source as the page, never its unrelated default displayedIsin.
  const url = new URL(`${DATA_ENDPOINT};ddsSources=FUNDPRICES_HIST`)
  url.searchParams.set('ISIN', isin)
  return url
}

function priceDate(value, today) {
  const parts = typeof value === 'string' && /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(value.trim())
  const date = parts && `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  if (!validDate(date, today)) throw new ProviderError('invalid_price', 'Erste returned an invalid NAV date. No price was used.')
  return date
}

function nav(value) {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:[,.]\d+)?$/.test(value.trim())
      ? Number(value.trim().replace(',', '.')) : NaN
  return Number.isFinite(number) && number > 0 ? number : null
}

export function parseErstePrices(data, isin, today) {
  if (!isRecord(data) || !Array.isArray(data.FUNDPRICES_HIST)) {
    throw invalid('Erste returned an unexpected historical-price response. No price was used.')
  }
  const matches = data.FUNDPRICES_HIST.filter(item => isRecord(item) && item.ISIN === isin)
  if (matches.length !== 1) {
    throw new ProviderError('unverified_instrument', 'Erste did not return one unambiguous match for the requested ISIN.')
  }
  const rows = matches[0].PRICES
  if (!Array.isArray(rows)) throw invalid('Erste did not return a historical NAV table.')
  if (!rows.length) throw new ProviderError('no_prices', 'Erste returned no NAV prices for this fund.')
  const prices = rows.map(row => {
    if (!isRecord(row) || typeof row.CURRENCY !== 'string') {
      throw invalid('Erste returned a price without verifiable currency metadata.')
    }
    return { date: priceDate(row.DAT_STATISTIK, today), currency: row.CURRENCY, close: nav(row.NAV) }
  })
  const latest = prices.reduce((a, b) => a.date >= b.date ? a : b)
  if (latest.currency !== 'EUR' || latest.close === null) {
    throw new ProviderError('invalid_price', 'Erste did not return a valid latest EUR NAV. No older or foreign-currency price was substituted.')
  }
  const history = new Map()
  for (const row of prices.filter(row => row.currency === 'EUR')) {
    if (history.has(row.date) && history.get(row.date).close !== row.close) {
      throw invalid('Erste returned conflicting NAV prices for the same date.')
    }
    history.set(row.date, { date: row.date, close: row.close })
  }
  return { price: latest.close, priceDate: latest.date, history: [...history.values()] }
}

export class ErsteWebsiteSource {
  constructor({ fetchImpl = fetch, now = Date.now } = {}) {
    this.fetch = fetchImpl
    this.now = now
    this.rateLimitedUntil = 0
  }

  async request(url, format) {
    if (this.now() < this.rateLimitedUntil) {
      throw new ProviderError('rate_limit', 'Erste website rate limit reached. Please wait before refreshing.')
    }
    let response
    try {
      response = await this.fetch(url, {
        signal: AbortSignal.timeout(15_000), redirect: 'error',
        headers: { Accept: format === 'json' ? 'application/json' : 'text/html', 'Accept-Language': 'en-SK' },
      })
    } catch {
      throw new ProviderError('network_error', 'Could not reach the Erste website, or the request timed out.')
    }
    if (response.status === 429) {
      const retry = response.headers.get('retry-after')
      const seconds = retry === null ? NaN : Number(retry)
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? '') - this.now()
      this.rateLimitedUntil = this.now() + Math.max(60_000, Number.isFinite(delay) ? Math.min(delay, 7 * 86400_000) : 60_000)
      throw new ProviderError('rate_limit', 'Erste website rate limit reached. Please wait before refreshing.')
    }
    if (!response.ok) throw new ProviderError('provider_error', 'The Erste website is unavailable or denied access. Try again later.')
    try {
      return format === 'json' ? await response.json() : await response.text()
    } catch {
      throw invalid('The Erste website returned unreadable data. No price was used.')
    }
  }

  async quote(isin) {
    const html = await this.request(ERSTE_PAGE, 'html')
    const url = websiteDataUrl(html, isin)
    const data = await this.request(url, 'json')
    return parseErstePrices(data, isin, new Date(this.now()).toISOString().slice(0, 10))
  }
}
