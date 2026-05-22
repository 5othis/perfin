import type { Account, AccountType, Snapshot } from '@/types'

const BASE = '/api'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${options?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

// ── Init (no-op - backend handles schema + seed) ──────────────────────────────

export async function initDatabase(): Promise<void> {
  // connectivity check
  await api<unknown>('/accounts')
}

// ── Account CRUD ──────────────────────────────────────────────────────────────

export async function dbGetAccounts(): Promise<Account[]> {
  return api<Account[]>('/accounts')
}

export async function dbAddAccount(name: string, type: AccountType): Promise<Account> {
  return api<Account>('/accounts', { method: 'POST', body: JSON.stringify({ name, type }) })
}

export async function dbUpdateAccount(id: string, name: string, type: AccountType): Promise<void> {
  await api(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ name, type }) })
}

export async function dbDeleteAccount(id: string): Promise<void> {
  await api(`/accounts/${id}`, { method: 'DELETE' })
}

// ── Snapshot CRUD ─────────────────────────────────────────────────────────────

export async function dbGetSnapshots(): Promise<Snapshot[]> {
  return api<Snapshot[]>('/snapshots')
}

export async function dbSaveSnapshot(date: string, balances: Record<string, number>): Promise<void> {
  await api(`/snapshots/${date}`, { method: 'PUT', body: JSON.stringify(balances) })
}

export async function dbDeleteSnapshot(date: string): Promise<void> {
  await api(`/snapshots/${date}`, { method: 'DELETE' })
}

// ── Full replace (import) ─────────────────────────────────────────────────────

export async function dbReplaceAll(accounts: Account[], snapshots: Snapshot[]): Promise<void> {
  await api('/import', { method: 'POST', body: JSON.stringify({ accounts, snapshots }) })
}
