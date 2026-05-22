import type { FinanceData } from '@/types'

export function exportToJson(data: FinanceData): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `perfin_backup_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function importFromJson(file: File): Promise<FinanceData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string)
        const data = migrateData(raw)
        resolve(data)
      } catch (err) {
        reject(new Error('Invalid JSON file: ' + (err as Error).message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function migrateData(raw: unknown): FinanceData {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Root must be an object')
  }
  const obj = raw as Record<string, unknown>
  const version = typeof obj.version === 'number' ? obj.version : 1
  if (!Array.isArray(obj.accounts)) throw new Error('Missing accounts array')
  if (!Array.isArray(obj.snapshots)) throw new Error('Missing snapshots array')
  return {
    version,
    accounts: obj.accounts as FinanceData['accounts'],
    snapshots: obj.snapshots as FinanceData['snapshots'],
  }
}
