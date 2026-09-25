const svgNamespace = 'http://www.w3.org/2000/svg'
const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const euro = cents => money.format(cents / 100)
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const displayDate = date => dateFormat.format(new Date(dayTime(date)))
const axisNumber = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const axisEuro = cents => Math.abs(cents) >= 10_000_000 ? `${axisNumber.format(cents / 100_000)} Tsd. €` : euro(cents)
const valuationTitle = 'Historical value of current holdings'
const investedTitle = 'Net invested cash (CSV)'
const byId = id => document.getElementById(id)
const dayTime = date => Date.parse(`${date}T00:00:00Z`)

export function periodPoints(points, period) {
  if (!points.length || period === 'ALL') return points
  const end = new Date(dayTime(points.at(-1).date))
  const months = { '1M': 1, '3M': 3, '1Y': 12 }[period]
  const originalDay = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() - months)
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  end.setUTCDate(Math.min(originalDay, lastDay))
  const cutoff = end.toISOString().slice(0, 10)
  return points.filter(point => point.date >= cutoff)
}

function svgElement(name, attributes, text) {
  const element = document.createElementNS(svgNamespace, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  if (text !== undefined) element.textContent = text
  return element
}

export function selectedChartData(history, funds, transactions, selection, metric) {
  const all = selection === 'ALL'
  const selected = new Set(all ? [...funds, ...(transactions?.byFund ?? [])].map(fund => fund.isin) : selection)
  if (!all && !selected.size) return {
    points: [], title: metric === 'portfolio' ? valuationTitle : investedTitle, coverage: 'No funds selected.',
    empty: 'Select at least one fund using the checkboxes above.',
  }
  const single = !all && selected.size === 1
  const isin = single ? [...selected][0] : null
  const fund = funds.find(item => item.isin === isin)
  const name = fund?.name ?? transactions?.byFund?.find(item => item.isin === isin)?.name ?? isin
  if (metric === 'portfolio') {
    const included = funds.filter(item => selected.has(item.isin) && item.status === 'available')
    const partial = all ? history?.partial : included.length < selected.size
    let points = single ? fund?.valueHistory ?? [] : history?.points ?? []
    let overflow = false
    if (!all && !single) {
      const series = included.map(item => new Map((item.valueHistory ?? []).map(point => [point.date, point.valueCents])))
      points = [...(series[0] ?? [])].flatMap(([date]) => {
        if (!series.every(values => values.has(date))) return []
        const total = series.reduce((sum, values) => sum + BigInt(values.get(date)), 0n)
        if (total > BigInt(Number.MAX_SAFE_INTEGER)) overflow = true
        return [{ date, valueCents: Number(total) }]
      }).sort((a, b) => a.date.localeCompare(b.date))
    }
    return {
      points: overflow ? [] : points,
      title: valuationTitle,
      coverage: single ? `${name} · ${isin}. ${fund?.status === 'available' ? 'Current units × this fund’s own EUR price history.' : fund?.message ?? 'Price history unavailable.'}`
        : `${partial ? 'Partial coverage · ' : ''}${included.length} of ${selected.size} selected funds included${partial ? '; unavailable funds excluded throughout.' : '.'} Combined holding values on shared price dates.`,
      empty: overflow ? 'Selected holding values exceed the supported calculation range.'
        : single ? 'No price history available for this fund. Refresh or restart the server if it was updated.'
        : all && !history ? 'Portfolio history unavailable. Refresh or restart the server if it was updated.'
          : 'No historical values available on shared price dates.',
    }
  }
  const records = transactions?.status === 'available'
    ? transactions.transactions.filter(row => all || selected.has(row.isin)) : []
  const dates = new Map()
  for (const row of records) dates.set(row.date, (dates.get(row.date) ?? 0n) + BigInt(row.operation === 'buy' ? row.amountCents : -row.amountCents))
  let sum = 0n
  let overflow = false
  const points = all ? transactions?.status === 'available' ? transactions.points : [] : [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => {
    sum += amount
    if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < -BigInt(Number.MAX_SAFE_INTEGER)) overflow = true
    return { date, valueCents: Number(sum) }
  })
  const recorded = new Set(records.map(row => row.isin))
  const missing = [...selected].filter(isin => !recorded.has(isin)).length
  return {
    points: overflow ? [] : points,
    title: investedTitle,
    coverage: transactions?.status === 'available'
      ? `${single ? `${name} · ${isin}. ` : ''}${recorded.size} of ${selected.size} selected funds have CSV records · ${records.length} transactions${points.length ? ` · ${displayDate(points[0].date)} to ${displayDate(points.at(-1).date)}` : ''}. Nothing outside the CSV records is assumed.${missing ? ` ${missing} selected fund(s) have no CSV records; their investments are unknown, not zero.` : ''}`
      : transactions?.message ?? 'Loading transaction CSV...',
    empty: overflow ? 'Selected invested amounts exceed the supported calculation range.'
      : 'No CSV transactions recorded for the selected funds. This is not a zero investment balance.',
  }
}

export function createHistoryChart() {
  let history = null
  let transactions = null
  let funds = []
  let period = 'ALL'
  let metric = 'invested'
  let selectedIndex = 0
  let visible = []
  let positions = []
  let cursor
  let dot
  let tooltip
  let tooltipDate
  let tooltipValue
  let tooltipBox
  const svg = byId('history-chart')
  const details = byId('history-details')
  const picker = byId('chart-funds')
  const allFunds = byId('chart-all-funds')
  let selectedIsins = null

  function syncCheckboxes() {
    const boxes = [...picker.querySelectorAll('input')]
    for (const box of boxes) box.checked = selectedIsins === null || selectedIsins.has(box.value)
    const checked = boxes.filter(box => box.checked).length
    allFunds.checked = selectedIsins === null || (boxes.length > 0 && checked === boxes.length)
    allFunds.indeterminate = checked > 0 && checked < boxes.length
  }

  function hideTooltip() {
    for (const element of [cursor, dot, tooltip]) element?.setAttribute('visibility', 'hidden')
  }

  function inspect(index, pointer, announce = false) {
    const point = visible[index]
    if (!point) return
    selectedIndex = index
    const label = `${displayDate(point.date)} · ${euro(point.valueCents)}`
    if (announce) byId('chart-announcement').textContent = label
    const { x, y } = positions[index]
    cursor.setAttribute('x1', x)
    cursor.setAttribute('x2', x)
    dot.setAttribute('cx', x)
    dot.setAttribute('cy', y)
    tooltipDate.textContent = displayDate(point.date)
    tooltipValue.textContent = euro(point.valueCents)
    for (const element of [cursor, dot, tooltip]) element.setAttribute('visibility', 'visible')
    const width = Math.max(tooltipDate.getComputedTextLength(), tooltipValue.getComputedTextLength()) + 24
    tooltipBox.setAttribute('width', width)
    const anchor = pointer ?? { x, y }
    const maxX = svg.viewBox.baseVal.width - width - 2
    const tooltipX = Math.max(2, Math.min(maxX, anchor.x + 12))
    const tooltipY = anchor.y < 70 ? anchor.y + 14 : anchor.y - 62
    const maxY = svg.viewBox.baseVal.height - 56
    tooltip.setAttribute('transform', `translate(${tooltipX},${Math.max(2, Math.min(maxY, tooltipY))})`)
  }

  function renderTable() {
    const rows = []
    if (details.open) {
      for (const point of visible) {
        const row = document.createElement('tr')
        for (const value of [displayDate(point.date), euro(point.valueCents)]) {
          const cell = document.createElement('td')
          cell.textContent = value
          row.append(cell)
        }
        rows.push(row)
      }
    }
    byId('history-rows').replaceChildren(...rows)
  }

  function render() {
    const invested = metric === 'invested'
    const selection = selectedChartData(history, funds, transactions, selectedIsins === null ? 'ALL' : [...selectedIsins], metric)
    visible = periodPoints(selection.points, period)
    positions = []
    byId('chart-announcement').textContent = ''
    byId('chart-title').textContent = selection.title
    byId('chart-description').textContent = invested
      ? 'Cumulative recorded purchases minus sales in EUR. This is invested cash, not portfolio value or investment returns. The line changes only on transaction dates.'
      : 'Current units × historical end-of-day price / NAV. Not your actual historical portfolio balance or investment return. Combined values use shared price dates only; missing prices are not estimated.'
    byId('chart-coverage').textContent = selection.coverage
    byId('history-caption').textContent = `${selection.title} - selected period`
    byId('chart-content').hidden = !visible.length
    byId('chart-empty').hidden = Boolean(visible.length)
    byId('chart-empty').textContent = selection.empty
    byId('chart-summary').textContent = ''
    svg.replaceChildren()
    renderTable()
    if (!visible.length) return

    // Scale against calendar time, not array positions, so gaps keep their real duration.
    const times = visible.map(point => dayTime(point.date))
    const values = visible.map(point => point.valueCents)
    let min = Math.min(...values)
    let max = Math.max(...values)
    const padding = Math.max((max - min) * .12, max * .005, 100)
    min = invested ? Math.min(0, min - padding) : Math.max(0, min - padding)
    max += padding
    const left = 106
    const width = Math.max(240, svg.clientWidth)
    const height = svg.clientHeight || 380
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const right = width - 12
    const top = 18
    const bottom = height - 42
    const start = times[0]
    const duration = times.at(-1) - start
    positions = visible.map((point, index) => ({
      x: duration ? left + (times[index] - start) / duration * (right - left) : (left + right) / 2,
      y: bottom - (point.valueCents - min) / (max - min) * (bottom - top),
    }))
    for (let index = 0; index <= 4; index++) {
      const y = top + (bottom - top) * index / 4
      const value = max - (max - min) * index / 4
      svg.append(
        svgElement('line', { x1: left, x2: right, y1: y, y2: y, class: 'chart-grid' }),
        svgElement('text', { x: left - 12, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' }, axisEuro(value)),
      )
    }
    const dateTicks = duration ? width > 650 ? [0, .5, 1] : [0, 1] : [.5]
    for (const fraction of dateTicks) {
      const tickDate = new Date(start + duration * fraction).toISOString().slice(0, 10)
      svg.append(svgElement('text', {
        x: left + (right - left) * fraction, y: height - 12,
        'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle',
        class: 'chart-axis',
      }, displayDate(tickDate)))
    }
    svg.append(svgElement('path', {
        d: positions.map(({ x, y }, index) => !index ? `M${x},${y}` : invested ? `H${x}V${y}` : `L${x},${y}`).join(' '),
        class: 'chart-line',
      }))
    cursor = svgElement('line', { y1: top, y2: bottom, class: 'chart-cursor' })
    dot = svgElement('circle', { r: 4, class: 'chart-dot' })
    tooltip = svgElement('g', { class: 'chart-tooltip', 'aria-hidden': 'true' })
    tooltipBox = svgElement('rect', { height: 54, rx: 5 })
    tooltipDate = svgElement('text', { x: 12, y: 20 })
    tooltipValue = svgElement('text', { x: 12, y: 40, class: 'tooltip-value' })
    tooltip.append(tooltipBox, tooltipDate, tooltipValue)
    svg.append(cursor, dot, tooltip)
    const first = visible[0]
    const last = visible.at(-1)
    byId('chart-summary').textContent = `${displayDate(first.date)}: ${euro(first.valueCents)} → ${displayDate(last.date)}: ${euro(last.valueCents)} · ${visible.length} observations`
    selectedIndex = visible.length - 1
    hideTooltip()
  }

  document.querySelectorAll('[data-period]').forEach(button => {
    button.addEventListener('click', () => {
      period = button.dataset.period
      document.querySelectorAll('[data-period]').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button))
      })
      render()
    })
  })
  document.querySelectorAll('[data-metric]').forEach(button => {
    button.addEventListener('click', () => {
      metric = button.dataset.metric
      document.querySelectorAll('[data-metric]').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button))
      })
      render()
    })
  })
  allFunds.addEventListener('change', () => {
    selectedIsins = allFunds.checked ? null : new Set()
    syncCheckboxes()
    render()
  })
  picker.addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return
    const boxes = [...picker.querySelectorAll('input')]
    selectedIsins = boxes.every(box => box.checked) ? null : new Set(boxes.filter(box => box.checked).map(box => box.value))
    syncCheckboxes()
    render()
  })
  details.addEventListener('toggle', renderTable)
  function pointerInspect(event) {
    const matrix = svg.getScreenCTM()
    if (!positions.length || !matrix) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    let closest = 0
    for (let index = 1; index < positions.length; index++) {
      if (metric === 'invested' ? positions[index].x <= point.x
        : Math.abs(positions[index].x - point.x) < Math.abs(positions[closest].x - point.x)) closest = index
    }
    inspect(closest, point)
  }
  svg.addEventListener('pointermove', pointerInspect)
  svg.addEventListener('pointerdown', pointerInspect)
  svg.addEventListener('pointerleave', hideTooltip)
  svg.addEventListener('pointercancel', hideTooltip)
  svg.addEventListener('blur', hideTooltip)
  svg.addEventListener('focus', () => inspect(selectedIndex, undefined, true))
  svg.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideTooltip(); return }
    if (!visible.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : Math.max(0, Math.min(visible.length - 1, selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1)))
    inspect(index, undefined, true)
  })
  const resize = new ResizeObserver(() => {
    if (history || transactions) render()
  })
  resize.observe(byId('chart-content'))
  return (data, holdings, ledger) => {
    history = data
    funds = holdings
    transactions = ledger
    const options = new Map((ledger?.byFund ?? []).map(fund => [fund.isin, fund.name]))
    for (const fund of funds) options.set(fund.isin, fund.name)
    picker.replaceChildren(...[...options].map(([isin, name]) => {
      const label = document.createElement('label')
      label.className = 'fund-option'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.value = isin
      const text = document.createElement('span')
      text.textContent = name
      const code = document.createElement('small')
      code.textContent = isin
      text.append(code)
      label.append(checkbox, text)
      return label
    }))
    syncCheckboxes()
    render()
  }
}
