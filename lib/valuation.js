function decimalFraction(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) throw new RangeError('Expected a non-negative decimal.')
  const fraction = match[2] ?? ''
  const scale = fraction.length - Number(match[3] ?? 0)
  if (Math.abs(scale) > 100) throw new RangeError('Decimal is out of range.')
  const digits = BigInt(match[1] + fraction)
  return scale >= 0
    ? [digits, 10n ** BigInt(scale)]
    : [digits * 10n ** BigInt(-scale), 1n]
}

function safeInteger(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Valuation exceeds the supported range.')
  }
  return Number(value)
}

export function valueInCents(units, price) {
  const [unitNumerator, unitDenominator] = decimalFraction(units)
  const [priceNumerator, priceDenominator] = decimalFraction(price)
  const numerator = unitNumerator * priceNumerator * 100n
  const denominator = unitDenominator * priceDenominator
  // Round each holding to cents (half up), then sum the displayed values.
  return safeInteger((numerator * 2n + denominator) / (denominator * 2n))
}

export function summarize(funds) {
  const available = funds.filter(fund => fund.status === 'available')
  const total = available.reduce((sum, fund) => sum + BigInt(fund.valueCents), 0n)
  const partial = available.length !== funds.length
  return {
    totalCents: safeInteger(total),
    availableCount: available.length,
    partial,
    totalLabel: partial ? 'Partial total' : 'Total portfolio value',
  }
}

export function validateHoldings(holdings) {
  const seen = new Set()
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error('Configure at least one holding in holdings.js.')
  }
  for (const holding of holdings) {
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(holding.isin) || seen.has(holding.isin) ||
        typeof holding.name !== 'string' || !holding.name.trim() ||
        typeof holding.units !== 'string' || !/^\d+(?:\.\d{1,9})?$/.test(holding.units) ||
        !Number.isFinite(Number(holding.units)) || Number(holding.units) > 1e9 ||
        !['eodhd', 'erste-website'].includes(holding.provider ?? 'eodhd')) {
      throw new Error('Invalid holding: check unique ISINs, names, and decimal-string units in holdings.js.')
    }
    seen.add(holding.isin)
  }
}
