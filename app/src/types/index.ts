export type AccountType = 'bank' | 'savings' | 'investment' | 'crypto' | 'cash'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: string
  order: number
}

export interface Snapshot {
  date: string
  balances: Record<string, number>
}

export interface FinanceData {
  version: number
  accounts: Account[]
  snapshots: Snapshot[]
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank',
  savings: 'Savings',
  investment: 'Investment',
  crypto: 'Crypto',
  cash: 'Cash',
}

export const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  bank: '#3B82F6',
  savings: '#10B981',
  investment: '#8B5CF6',
  crypto: '#F59E0B',
  cash: '#6B7280',
}
