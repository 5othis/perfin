import test from 'node:test'
import assert from 'node:assert/strict'
import { holdings } from '../holdings.js'
import { summarize, validateHoldings, valueInCents } from '../lib/valuation.js'

test('configured quantities are decimals, not thousands', () => {
  validateHoldings(holdings)
  assert.deepEqual(holdings.map(holding => holding.units), ['1.882', '2.993', '13.874', '96284'])
})

test('each multiplication and the complete total are exact in cents', () => {
  const prices = [123.45, 67.89, 10.25, 0.123456] // Synthetic arithmetic inputs, not market quotes.
  const funds = holdings.map((holding, index) => ({
    status: 'available',
    valueCents: valueInCents(holding.units, prices[index]),
  }))
  assert.deepEqual(funds.map(fund => fund.valueCents), [23233, 20319, 14221, 1188684])
  assert.deepEqual(summarize(funds), {
    totalCents: 1246457, availableCount: 4, partial: false, totalLabel: 'Total portfolio value',
  })
})

test('partial total includes only funds with available prices', () => {
  assert.deepEqual(summarize([
    { status: 'available', valueCents: 23233 },
    { status: 'unavailable', valueCents: null },
    { status: 'available', valueCents: 14221 },
  ]), { totalCents: 37454, availableCount: 2, partial: true, totalLabel: 'Partial total' })
})

test('all-unavailable portfolio is an explicitly partial empty sum', () => {
  assert.deepEqual(summarize(holdings.map(() => ({ status: 'unavailable', valueCents: null }))), {
    totalCents: 0, availableCount: 0, partial: true, totalLabel: 'Partial total',
  })
})

test('decimal arithmetic rounds half up without binary floating point errors', () => {
  assert.equal(valueInCents('1', 1.005), 101)
  assert.equal(valueInCents('3', 0.335), 101)
  assert.equal(valueInCents('0', 123.45), 0)
  assert.equal(valueInCents('1000000', 1e-7), 10)
  assert.equal(valueInCents('1.23456789', 100), 12346)
  assert.equal(summarize([
    { status: 'available', valueCents: valueInCents('1', 0.005) },
    { status: 'available', valueCents: valueInCents('1', 0.005) },
  ]).totalCents, 2)
})

test('invalid quantities and unsafe values are rejected rather than misvalued', () => {
  for (const value of ['1,882', '-1', 'NaN', '', '1e309']) {
    assert.throws(() => validateHoldings([{ ...holdings[0], units: value }]))
  }
  assert.throws(() => validateHoldings([holdings[0], holdings[0]]))
  assert.throws(() => valueInCents('1000000000', 1e20), RangeError)
})
