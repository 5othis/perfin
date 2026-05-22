<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900">Accounts</h1>
      <button
        @click="openAdd"
        class="flex items-center gap-1.5 text-sm px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
      >
        <PlusIcon class="w-4 h-4" />
        Add Account
      </button>
    </div>

    <!-- Add / Edit inline form -->
    <div v-if="showForm" class="bg-white rounded-2xl shadow-sm border border-indigo-100 p-5 space-y-4">
      <h2 class="text-sm font-semibold text-gray-700">{{ editingId ? 'Edit Account' : 'New Account' }}</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="e.g. mbank funds"
            class="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select
            v-model="form.type"
            class="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option v-for="(label, val) in ACCOUNT_TYPE_LABELS" :key="val" :value="val">{{ label }}</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 justify-end">
        <button @click="cancelForm" class="text-sm px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
        <button @click="submitForm" :disabled="!form.name.trim()" class="text-sm px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40">
          {{ editingId ? 'Save' : 'Add' }}
        </button>
      </div>
    </div>

    <!-- Accounts table -->
    <div v-if="store.sortedAccounts.length === 0" class="text-center py-16 text-gray-400">
      <BanknotesIcon class="w-10 h-10 mx-auto mb-3 text-gray-200" />
      <p class="text-sm">No accounts yet. Add your first account above.</p>
    </div>

    <div v-else class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table class="min-w-full divide-y divide-gray-100 text-sm">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Latest Balance</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="acc in store.sortedAccounts" :key="acc.id" class="hover:bg-gray-50">
            <td class="px-6 py-3 font-medium text-gray-800">{{ acc.name }}</td>
            <td class="px-6 py-3">
              <span
                :style="{ backgroundColor: ACCOUNT_TYPE_COLORS[acc.type] + '22', color: ACCOUNT_TYPE_COLORS[acc.type] }"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
              >
                {{ ACCOUNT_TYPE_LABELS[acc.type] }}
              </span>
            </td>
            <td class="px-6 py-3 text-right text-gray-700 font-medium transition-all duration-200 select-none" :style="privacy ? 'filter:blur(10px)' : ''">
              {{ formatEur(store.latestBalances[acc.id] ?? 0) }}
            </td>
            <td class="px-6 py-3 text-right">
              <div class="flex items-center justify-end gap-2">
                <button @click="openEdit(acc)" class="text-gray-400 hover:text-indigo-600 transition-colors">
                  <PencilIcon class="w-4 h-4" />
                </button>
                <button @click="handleDelete(acc.id, acc.name)" class="text-gray-400 hover:text-red-500 transition-colors">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog
      v-if="confirmDelete"
      title="Delete account"
      :message="`Delete '${confirmDelete.name}'? Historical balance data in snapshots will be preserved.`"
      @confirm="doDelete"
      @cancel="confirmDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { PlusIcon, PencilIcon, TrashIcon, BanknotesIcon } from '@heroicons/vue/24/outline'
import { usePrivacy } from '@/composables/usePrivacy'
import { useFinanceStore } from '@/stores/finance'
import { formatEur } from '@/utils/format'
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_COLORS } from '@/types'
import type { Account, AccountType } from '@/types'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const store = useFinanceStore()
const { privacy } = usePrivacy()

const showForm = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({ name: '', type: 'bank' as AccountType })

function openAdd() {
  editingId.value = null
  form.name = ''
  form.type = 'bank'
  showForm.value = true
}

function openEdit(acc: Account) {
  editingId.value = acc.id
  form.name = acc.name
  form.type = acc.type
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
}

function submitForm() {
  if (!form.name.trim()) return
  if (editingId.value) {
    store.updateAccount(editingId.value, form.name.trim(), form.type)
  } else {
    store.addAccount(form.name.trim(), form.type)
  }
  cancelForm()
}

const confirmDelete = ref<{ id: string; name: string } | null>(null)

function handleDelete(id: string, name: string) {
  confirmDelete.value = { id, name }
}

function doDelete() {
  if (confirmDelete.value) store.deleteAccount(confirmDelete.value.id)
  confirmDelete.value = null
}
</script>
