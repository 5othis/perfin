import { summarize, valueInCents } from './valuation.js'

export function fundHistory(fund) {
  if (fund.status !== 'available') return []
  const values = new Map()
  for (const row of fund.history) {
    if (typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0) continue
    try {
      values.set(row.date, valueInCents(fund.units, row.close))
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      // An unrepresentable historical value is a missing observation, never zero.
    }
  }
  return [...values].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, valueCents]) => ({ date, valueCents }))
}

export function portfolioHistory(funds) {
  const included = funds.filter(fund => fund.status === 'available')
  const result = {
    partial: included.length !== funds.length,
    includedIsins: included.map(fund => fund.isin),
    points: [],
  }
  if (!included.length) return result

  const series = included.map(fund => new Map(fundHistory(fund).map(point => [point.date, point.valueCents])))

  for (const day of [...series[0].keys()].sort()) {
    if (!series.every(values => values.has(day))) continue
    const values = series.map(values => ({ status: 'available', valueCents: values.get(day) }))
    result.points.push({ date: day, valueCents: summarize(values).totalCents })
  }
  return result
}
