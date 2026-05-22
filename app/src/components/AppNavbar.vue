<template>
  <nav class="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
      <div class="flex items-center gap-6">
        <span class="font-bold text-indigo-600 text-lg tracking-tight">PerFin</span>
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
          active-class="text-indigo-600 border-b-2 border-indigo-600 pb-0.5"
        >
          {{ link.label }}
        </RouterLink>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="toggle"
          class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          :title="privacy ? 'Show balances' : 'Hide balances'"
        >
          <EyeSlashIcon v-if="privacy" class="w-5 h-5" />
          <EyeIcon v-else class="w-5 h-5" />
        </button>
        <button
          @click="handleExport"
          class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <ArrowUpTrayIcon class="w-4 h-4" />
          Export
        </button>
        <label class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors cursor-pointer">
          <ArrowDownTrayIcon class="w-4 h-4" />
          Import
          <input type="file" accept=".json" class="hidden" @change="handleImport" />
        </label>
      </div>
    </div>
  </nav>
  <ConfirmDialog
    v-if="showConfirm"
    title="Import data"
    message="This will replace all current data with the imported file. Continue?"
    @confirm="confirmImport"
    @cancel="cancelImport"
  />
</template>

<script setup lang="ts">
import { ref, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowUpTrayIcon, ArrowDownTrayIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { usePrivacy } from '@/composables/usePrivacy'
import { useFinanceStore } from '@/stores/finance'
import { exportToJson, importFromJson } from '@/utils/importExport'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const store = useFinanceStore()
const showToast = inject<(msg: string, type?: 'success' | 'error') => void>('showToast')!
const { privacy, toggle } = usePrivacy()

const navLinks = [
  { to: '/', label: 'Dashboard' },
  { to: '/snapshot', label: 'Update Balances' },
  { to: '/history', label: 'History' },
  { to: '/accounts', label: 'Accounts' },
]

function handleExport() {
  exportToJson(store.exportData())
  showToast('Data exported successfully')
}

const showConfirm = ref(false)
const pendingFile = ref<File | null>(null)

function handleImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  pendingFile.value = file
  showConfirm.value = true
  ;(e.target as HTMLInputElement).value = ''
}

async function confirmImport() {
  showConfirm.value = false
  if (!pendingFile.value) return
  try {
    const data = await importFromJson(pendingFile.value)
    store.replaceAll(data)
    showToast('Data imported successfully')
  } catch (err) {
    showToast((err as Error).message, 'error')
  }
  pendingFile.value = null
}

function cancelImport() {
  showConfirm.value = false
  pendingFile.value = null
}
</script>
