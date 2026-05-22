<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900">Update Balances</h1>
    </div>

    <div v-if="store.sortedAccounts.length === 0" class="text-center py-16 text-gray-500">
      <p>No accounts found. <RouterLink to="/accounts" class="text-indigo-600 hover:underline">Add accounts first.</RouterLink></p>
    </div>

    <template v-else>
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
        <!-- Date -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Snapshot Date</label>
          <input
            v-model="snapshotDate"
            type="date"
            class="block w-48 rounded-lg border-gray-300 shadow-sm text-sm focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p v-if="isExistingDate" class="mt-1 text-xs text-amber-600">A snapshot for this date already exists — saving will overwrite it.</p>
        </div>

        <hr class="border-gray-100" />

        <!-- Balance inputs grouped by type -->
        <div
          v-for="(group, type) in accountsByType"
          :key="type"
          class="space-y-3"
        >
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">{{ ACCOUNT_TYPE_LABELS[type as AccountType] }}</h3>
          <div
            v-for="acc in group"
            :key="acc.id"
            class="flex items-center gap-3"
          >
            <label :for="acc.id" class="w-40 text-sm text-gray-700 truncate">{{ acc.name }}</label>
            <div class="relative flex-1 transition-all duration-200" :style="privacy ? 'filter:blur(10px)' : ''">
              <input
                :id="acc.id"
                v-model.number="balances[acc.id]"
                type="number"
                step="0.01"
                min="0"
                class="block w-full rounded-lg border-gray-300 shadow-sm text-sm pr-10 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">€</span>
            </div>
          </div>
        </div>

        <hr class="border-gray-100" />

        <!-- Total preview -->
        <div class="flex items-center justify-between text-sm font-semibold text-gray-700">
          <span>Total (this snapshot)</span>
          <span class="text-indigo-700 transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">{{ formatEur(snapshotTotal) }}</span>
        </div>

        <button
          @click="handleSave"
          class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Save Snapshot
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { usePrivacy } from '@/composables/usePrivacy'
import { RouterLink } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { formatEur } from '@/utils/format'
import { ACCOUNT_TYPE_LABELS } from '@/types'
import type { Account, AccountType } from '@/types'

const store = useFinanceStore()
const showToast = inject<(msg: string, type?: 'success' | 'error') => void>('showToast')!
const { privacy } = usePrivacy()

const today = new Date().toISOString().slice(0, 10)
const snapshotDate = ref(today)

const balances = ref<Record<string, number>>({})

// Prefill from latest snapshot
store.sortedAccounts.forEach((acc) => {
  balances.value[acc.id] = store.latestBalances[acc.id] ?? 0
})

const accountsByType = computed(() => {
  const groups: Record<string, Account[]> = {}
  store.sortedAccounts.forEach((acc) => {
    if (!groups[acc.type]) groups[acc.type] = []
    groups[acc.type].push(acc)
  })
  return groups
})

const snapshotTotal = computed(() =>
  Object.values(balances.value).reduce((s, v) => s + (v || 0), 0)
)

const isExistingDate = computed(() =>
  store.snapshots.some((s) => s.date === snapshotDate.value)
)

function handleSave() {
  store.saveSnapshot(snapshotDate.value, { ...balances.value })
  showToast('Snapshot saved')
}
</script>
