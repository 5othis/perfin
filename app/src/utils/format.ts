export function formatEur(value: number): string {
  return value.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatEurCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' M€'
  }
  if (Math.abs(value) >= 1_000) {
    return (value / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' k€'
  }
  return formatEur(value)
}
