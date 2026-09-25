import { summarize, validateHoldings, valueInCents } from './valuation.js'
import { fundHistory, portfolioHistory } from './history.js'
import { ProviderError } from './provider-error.js'
import { validDate } from './price-date.js'
import { ErsteWebsiteSource, ERSTE_PAGE } from './erste.js'

const MINUTE = 60_000
const MAPPING_TTL = 7 * 24 * 60 * MINUTE
const MISSING_TTL = 6 * 60 * MINUTE
const PRICE_TTL = 60 * MINUTE
const RETRY_TTL = MINUTE

const unavailable = (code, message) => new ProviderError(code, message)
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export class PortfolioService {
  constructor({ holdings, apiKey, fetchImpl = fetch, now = Date.now }) {
    validateHoldings(holdings)
    this.holdings = holdings
    this.apiKey = apiKey?.trim()
    this.fetch = fetchImpl
    this.now = now
    this.mappings = new Map()
    this.prices = new Map()
    this.inFlight = null
    this.rateLimitedUntil = 0
    this.erste = new ErsteWebsiteSource({ fetchImpl, now })
  }

  async request(path, params = {}) {
    if (this.now() < this.rateLimitedUntil) {
      throw unavailable('rate_limit', 'EODHD rate limit reached. Please wait before refreshing.')
    }
    const url = new URL(`https://eodhd.com/api/${path}`)
    url.search = new URLSearchParams({ ...params, api_token: this.apiKey, fmt: 'json' }).toString()
    let response
    try {
      response = await this.fetch(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
        headers: { Accept: 'application/json' },
      })
    } catch {
      // Never propagate fetch errors: their messages can contain the authenticated URL.
      throw unavailable('network_error', 'Could not reach EODHD, or the request timed out. Try again shortly.')
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter === null ? NaN : Number(retryAfter)
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter ?? '') - this.now()
      this.rateLimitedUntil = this.now() + Math.max(MINUTE, Number.isFinite(delay) ? delay : MINUTE)
      throw unavailable('rate_limit', 'EODHD rate limit reached. Please wait before refreshing.')
    }
    if (response.status === 401 || response.status === 403) {
      throw unavailable('access_denied', 'EODHD rejected access. Check the server API key and subscription permissions.')
    }
    if (response.status === 404) {
      throw unavailable('not_found', 'EODHD has no data for this request. Fund coverage could not be confirmed.')
    }
    if (!response.ok) {
      throw unavailable('provider_error', 'EODHD is temporarily unavailable. Try again shortly.')
    }
    try {
      return await response.json()
    } catch {
      throw unavailable('invalid_response', 'EODHD returned an unreadable response. No price was used.')
    }
  }

  async resolve(isin) {
    const cached = this.mappings.get(isin)
    if (cached && cached.expiresAt > this.now()) {
      if (cached.error) throw cached.error
      return cached.matches
    }
    const results = await this.request(`search/${encodeURIComponent(isin)}`, { type: 'fund', limit: '500' })
    if (!Array.isArray(results)) {
      throw unavailable('invalid_response', 'EODHD returned an unexpected search response. No instrument was selected.')
    }
    const exact = results.filter(item => isRecord(item) && item.ISIN === isin)
    const matches = exact.filter(item =>
      item.Currency === 'EUR' &&
      typeof item.Type === 'string' && ['fund', 'mutual fund'].includes(item.Type.trim().toLowerCase()) &&
      typeof item.Code === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(item.Code) &&
      typeof item.Exchange === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(item.Exchange)
    ).sort((a, b) => Number(b.isPrimary === true) - Number(a.isPrimary === true))
      .map(item => ({ symbol: `${item.Code}.${item.Exchange}`, isin, currency: 'EUR' }))

    if (matches.length === 0) {
      const error = unavailable('unverified_instrument', exact.length
        ? 'EODHD returned this ISIN, but a EUR fund symbol could not be verified. No alternate share class or currency was used.'
        : 'EODHD returned no fund with this exact ISIN. Coverage is unavailable or could not be verified.')
      this.mappings.set(isin, { error, expiresAt: this.now() + MISSING_TTL })
      throw error
    }
    const unique = [...new Map(matches.map(item => [item.symbol, item])).values()]
    this.mappings.set(isin, { matches: unique, expiresAt: this.now() + MAPPING_TTL })
    return unique
  }

  async latestPrice(symbol) {
    // No invented "limit" field or recent-date window: older NAVs must remain discoverable.
    const rows = await this.request(`eod/${encodeURIComponent(symbol)}`, { order: 'd', period: 'd' })
    if (!Array.isArray(rows)) {
      throw unavailable('invalid_response', 'EODHD returned an unexpected price response. No price was used.')
    }
    if (!rows.length) {
      throw unavailable('no_prices', 'EODHD resolved this fund, but returned no end-of-day prices.')
    }
    const today = new Date(this.now()).toISOString().slice(0, 10)
    if (rows.some(row => !isRecord(row) || !validDate(row.date, today))) {
      throw unavailable('invalid_price', 'EODHD returned an invalid price date. No price was used.')
    }
    const latest = rows.reduce((a, b) => a.date >= b.date ? a : b)
    if (typeof latest.close !== 'number' || !Number.isFinite(latest.close) || latest.close <= 0) {
      throw unavailable('invalid_price', 'EODHD did not return a valid latest closing price. No price was used.')
    }
    return {
      price: latest.close, priceDate: latest.date,
      history: rows.map(row => ({ date: row.date, close: row.close })),
    }
  }

  async fund(holding, refresh) {
    const cached = this.prices.get(holding.isin)
    if (cached && this.now() < cached.expiresAt && (!refresh || this.now() < cached.retryAt)) {
      return { ...cached.result, cached: true }
    }
    const base = {
      ...holding, currency: 'EUR', symbol: null, resolved: false,
      price: null, priceDate: null, valueCents: null, fetchedAt: null,
      provider: holding.provider ?? 'eodhd',
      sourceName: holding.provider === 'erste-website' ? 'Erste Asset Management website' : 'EODHD',
      sourceUrl: holding.provider === 'erste-website' ? ERSTE_PAGE : null,
    }
    if (!this.apiKey && base.provider === 'eodhd') {
      return {
        ...base, status: 'unavailable', code: 'missing_key', cached: false,
        message: 'Set EODHD_API_KEY in the server .env file and restart. Fund coverage has not been checked.',
        attemptedAt: null, retryAt: null,
      }
    }

    let result
    let ttl = PRICE_TTL
    const attemptedAt = new Date(this.now()).toISOString()
    const valuedQuote = quote => {
      let valueCents
      try {
        valueCents = valueInCents(holding.units, quote.price)
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        throw unavailable('invalid_price', 'The returned price is outside the supported valuation range.')
      }
      return {
        ...base, ...quote, valueCents, resolved: true, status: 'available', code: null, message: null,
        fetchedAt: new Date(this.now()).toISOString(),
      }
    }
    try {
      if (base.provider === 'erste-website') {
        result = valuedQuote(await this.erste.quote(holding.isin))
      } else {
        const matches = await this.resolve(holding.isin)
        base.resolved = true
        let lastError
        for (const match of matches) {
          base.symbol = match.symbol
          try {
            result = valuedQuote(await this.latestPrice(match.symbol))
            break
          } catch (error) {
            if (!(error instanceof ProviderError)) throw error
            if (!['not_found', 'no_prices', 'invalid_price'].includes(error.code)) throw error
            lastError = error
          }
        }
        if (!result) throw lastError
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error
      ttl = ['unverified_instrument', 'not_found', 'no_prices'].includes(error.code) ? MISSING_TTL : RETRY_TTL
      result = { ...base, status: 'unavailable', code: error.code, message: error.message }
    }
    const retryAt = Math.max(this.now() + RETRY_TTL,
      base.provider === 'erste-website' ? this.erste.rateLimitedUntil : this.rateLimitedUntil)
    result = { ...result, attemptedAt, retryAt: new Date(retryAt).toISOString(), cached: false }
    this.prices.set(holding.isin, { result, expiresAt: this.now() + ttl, retryAt })
    return result
  }

  getPortfolio({ refresh = false } = {}) {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.load(refresh).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  async load(refresh) {
    const results = await Promise.all(this.holdings.map(holding => this.fund(holding, refresh)))
    const history = portfolioHistory(results)
    const funds = results.map(({ history: rawHistory, ...fund }) => ({
      ...fund, valueHistory: fundHistory({ ...fund, history: rawHistory }),
    }))
    const fetched = funds.map(fund => fund.fetchedAt).filter(Boolean).sort()
    const attempted = funds.map(fund => fund.attemptedAt).filter(Boolean).sort()
    return {
      funds, history, ...summarize(funds), currency: 'EUR',
      servedAt: new Date(this.now()).toISOString(),
      lastFetchedAt: fetched.at(-1) ?? null,
      lastAttemptAt: attempted.at(-1) ?? null,
      source: 'EODHD and Erste Asset Management website end-of-day prices / fund NAVs; not live prices.',
    }
  }
}
