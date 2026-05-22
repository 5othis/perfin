import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Account, AccountType, FinanceData, Snapshot } from '@/types'
import {
  dbGetAccounts,
  dbGetSnapshots,
  dbAddAccount,
  dbUpdateAccount,
  dbDeleteAccount,
  dbSaveSnapshot,
  dbDeleteSnapshot,
  dbReplaceAll,
} from '@/db/database'

export const useFinanceStore = defineStore('finance', () => {
  const accounts = ref<Account[]>([])
  const snapshots = ref<Snapshot[]>([])

  async function loadFromDb(): Promise<void> {
    accounts.value = await dbGetAccounts()
    snapshots.value = await dbGetSnapshots()
  }

  const sortedSnapshots = computed(() =>
    [...snapshots.value].sort((a, b) => a.date.localeCompare(b.date))
  )

  const latestSnapshot = computed(() =>
    sortedSnapshots.value.at(-1) ?? null
  )

  const previousSnapshot = computed(() =>
    sortedSnapshots.value.at(-2) ?? null
  )

  const sortedAccounts = computed(() =>
    [...accounts.value].sort((a, b) => a.order - b.order)
  )

  const latestBalances = computed(() => {
    const snap = latestSnapshot.value
    if (!snap) return {} as Record<string, number>
    return snap.balances
  })

  const totalNetWorth = computed(() =>
    Object.values(latestBalances.value).reduce((s, v) => s + v, 0)
  )

  const previousNetWorth = computed(() => {
    const snap = previousSnapshot.value
    if (!snap) return null
    return Object.values(snap.balances).reduce((s, v) => s + v, 0)
  })

  const netWorthDelta = computed(() => {
    if (previousNetWorth.value === null) return null
    return totalNetWorth.value - previousNetWorth.value
  })

  const netWorthByType = computed(() => {
    const result: Record<string, number> = {}
    accounts.value.forEach((acc) => {
      const bal = latestBalances.value[acc.id] ?? 0
      result[acc.type] = (result[acc.type] ?? 0) + bal
    })
    return result
  })

  const netWorthHistory = computed(() =>
    sortedSnapshots.value.map((snap) => ({
      date: snap.date,
      total: Object.values(snap.balances).reduce((s, v) => s + v, 0),
    }))
  )

  function accountHistory(accountId: string) {
    return sortedSnapshots.value
      .filter((s) => accountId in s.balances)
      .map((s) => ({ date: s.date, value: s.balances[accountId] }))
  }

  async function addAccount(name: string, type: AccountType): Promise<void> {
    const acc = await dbAddAccount(name, type)
    accounts.value.push(acc)
  }

  async function updateAccount(id: string, name: string, type: AccountType): Promise<void> {
    await dbUpdateAccount(id, name, type)
    const acc = accounts.value.find((a) => a.id === id)
    if (acc) { acc.name = name; acc.type = type }
  }

  async function deleteAccount(id: string): Promise<void> {
    await dbDeleteAccount(id)
    accounts.value = accounts.value.filter((a) => a.id !== id)
    snapshots.value = snapshots.value.map((s) => {
      const b = { ...s.balances }
      delete b[id]
      return { ...s, balances: b }
    })
  }

  async function saveSnapshot(date: string, balances: Record<string, number>): Promise<void> {
    await dbSaveSnapshot(date, balances)
    const existing = snapshots.value.find((s) => s.date === date)
    if (existing) {
      existing.balances = { ...balances }
    } else {
      snapshots.value.push({ date, balances: { ...balances } })
    }
  }

  async function deleteSnapshot(date: string): Promise<void> {
    await dbDeleteSnapshot(date)
    snapshots.value = snapshots.value.filter((s) => s.date !== date)
  }

  async function replaceAll(data: FinanceData): Promise<void> {
    await dbReplaceAll(data.accounts, data.snapshots)
    accounts.value = data.accounts
    snapshots.value = data.snapshots
  }

  function exportData(): FinanceData {
    return { version: 1, accounts: accounts.value, snapshots: snapshots.value }
  }

  return {
    accounts,
    snapshots,
    sortedAccounts,
    sortedSnapshots,
    latestSnapshot,
    latestBalances,
    totalNetWorth,
    previousNetWorth,
    netWorthDelta,
    netWorthByType,
    netWorthHistory,
    accountHistory,
    loadFromDb,
    addAccount,
    updateAccount,
    deleteAccount,
    saveSnapshot,
    deleteSnapshot,
    replaceAll,
    exportData,
  }
})
