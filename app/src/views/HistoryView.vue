<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900">History</h1>

    <div v-if="store.sortedSnapshots.length < 2" class="text-center py-16 text-gray-500">
      <p class="text-sm">At least 2 snapshots are needed to show history.</p>
      <RouterLink to="/snapshot" class="text-indigo-600 hover:underline text-sm">Record a snapshot</RouterLink>
    </div>

    <template v-else>
      <!-- Net Worth history chart -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">Net Worth Over Time</h2>
        <div class="h-72">
          <NetWorthChart :history="store.netWorthHistory" />
        </div>
      </div>

      <!-- Per-account chart -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-gray-700">Account History</h2>
          <select
            v-model="selectedAccountId"
            class="text-sm rounded-lg border-gray-300 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option v-for="acc in store.sortedAccounts" :key="acc.id" :value="acc.id">
              {{ acc.name }}
            </option>
          </select>
        </div>
        <div class="h-56">
          <NetWorthChart
            :history="selectedAccountHistory"
            :label="selectedAccountName"
          />
        </div>
      </div>

      <!-- Snapshot table -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-700">All Snapshots</h2>
          <span class="text-xs text-gray-400">{{ store.sortedSnapshots.length }} snapshots</span>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Worth</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Change</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                v-for="(row, idx) in snapshotRows"
                :key="row.date"
                class="hover:bg-gray-50"
              >
                <td class="px-6 py-3 text-gray-800 font-medium">{{ row.date }}</td>
                <td class="px-6 py-3 text-right text-gray-900 font-semibold transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">{{ formatEur(row.total) }}</td>
                <td class="px-6 py-3 text-right">
                  <span
                    v-if="idx > 0"
                    :class="row.delta >= 0 ? 'text-emerald-600' : 'text-red-600'"
                    class="text-xs font-medium transition-all duration-200 select-none"
                    :style="privacy ? 'filter:blur(10px)' : ''"
                  >
                    {{ row.delta >= 0 ? '+' : '' }}{{ formatEur(row.delta) }}
                  </span>
                  <span v-else class="text-gray-300 text-xs">—</span>
                </td>
                <td class="px-6 py-3 text-right">
                  <button @click="deleteSnap(row.date)" class="text-gray-300 hover:text-red-500 transition-colors">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePrivacy } from '@/composables/usePrivacy'
import { RouterLink } from 'vue-router'
import { TrashIcon } from '@heroicons/vue/24/outline'
import { useFinanceStore } from '@/stores/finance'
import { formatEur } from '@/utils/format'
import NetWorthChart from '@/components/NetWorthChart.vue'

const store = useFinanceStore()
const { privacy } = usePrivacy()

const selectedAccountId = ref(store.sortedAccounts[0]?.id ?? '')

const selectedAccountName = computed(
  () => store.sortedAccounts.find((a) => a.id === selectedAccountId.value)?.name ?? ''
)

const selectedAccountHistory = computed(() => store.accountHistory(selectedAccountId.value))

const snapshotRows = computed(() => {
  const rows = store.netWorthHistory
  return rows.map((r, i) => ({
    ...r,
    delta: i === 0 ? 0 : r.total - rows[i - 1].total,
  }))
})

function deleteSnap(date: string) {
  store.deleteSnapshot(date)
}
</script>
