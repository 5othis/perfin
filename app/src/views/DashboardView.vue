<template>
  <div class="space-y-6">
    <!-- Empty state -->
    <div v-if="store.sortedAccounts.length === 0" class="text-center py-24 text-gray-500">
      <BanknotesIcon class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="text-lg font-medium">No accounts yet</p>
      <p class="text-sm mt-1">Go to <RouterLink to="/accounts" class="text-indigo-600 hover:underline">Accounts</RouterLink> to add your first account.</p>
    </div>

    <template v-else>
      <!-- Net Worth headline -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <p class="text-sm font-medium text-gray-500 uppercase tracking-wide">Total Net Worth</p>
        <p class="text-4xl font-bold text-gray-900 mt-1 transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">
          {{ formatEur(store.totalNetWorth) }}
        </p>
        <div v-if="store.netWorthDelta !== null" class="mt-2 flex items-center gap-1.5">
          <span
            :class="[
              'flex items-center gap-0.5 text-sm font-semibold px-2 py-0.5 rounded-full transition-all duration-200 select-none',
              store.netWorthDelta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
            ]"
            :style="privacy ? 'filter:blur(10px)' : ''"
          >
            <ArrowTrendingUpIcon v-if="store.netWorthDelta >= 0" class="w-3.5 h-3.5" />
            <ArrowTrendingDownIcon v-else class="w-3.5 h-3.5" />
            {{ store.netWorthDelta >= 0 ? '+' : '' }}{{ formatEur(store.netWorthDelta) }}
          </span>
          <span class="text-xs text-gray-400">vs previous snapshot</span>
        </div>
        <p v-if="store.latestSnapshot" class="text-xs text-gray-400 mt-3">Last updated: {{ store.latestSnapshot.date }}</p>
      </div>

      <!-- Charts row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 class="text-sm font-semibold text-gray-700 mb-4">By Account Type</h2>
          <div class="h-56">
            <BreakdownChart :by-type="store.netWorthByType" />
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 class="text-sm font-semibold text-gray-700 mb-4">Net Worth Over Time</h2>
          <div class="h-56">
            <NetWorthChart :history="store.netWorthHistory" />
          </div>
        </div>
      </div>

      <!-- Account list grouped by type -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
        <div
          v-for="(group, type) in accountsByType"
          :key="type"
        >
          <div class="px-6 py-3 bg-blue-50 flex items-center justify-between">
            <span class="text-xs font-semibold text-blue-500 uppercase tracking-wider">
              {{ ACCOUNT_TYPE_LABELS[type as AccountType] }}
            </span>
            <span class="text-xs font-semibold text-gray-600 transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">
              {{ formatEur(groupTotal(group)) }}
            </span>
          </div>
          <div
            v-for="acc in group"
            :key="acc.id"
            class="px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <span class="text-sm text-gray-800">{{ acc.name }}</span>
            <span class="text-sm font-medium text-gray-900 transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">
              {{ formatEur(store.latestBalances[acc.id] ?? 0) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { BanknotesIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/vue/24/outline'
import { usePrivacy } from '@/composables/usePrivacy'
import { useFinanceStore } from '@/stores/finance'
import { formatEur } from '@/utils/format'
import { ACCOUNT_TYPE_LABELS } from '@/types'
import type { Account, AccountType } from '@/types'
import BreakdownChart from '@/components/BreakdownChart.vue'
import NetWorthChart from '@/components/NetWorthChart.vue'

const store = useFinanceStore()
const { privacy } = usePrivacy()

const accountsByType = computed(() => {
  const groups: Record<string, Account[]> = {}
  store.sortedAccounts.forEach((acc) => {
    if (!groups[acc.type]) groups[acc.type] = []
    groups[acc.type].push(acc)
  })
  return groups
})

function groupTotal(accounts: Account[]) {
  return accounts.reduce((sum, a) => sum + (store.latestBalances[a.id] ?? 0), 0)
}
</script>
