<template>
  <div class="fixed bottom-6 right-6 z-50">
    <div
      :class="[
        'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white',
        type === 'success' ? 'bg-emerald-600' : 'bg-red-600',
      ]"
    >
      <CheckCircleIcon v-if="type === 'success'" class="w-5 h-5 shrink-0" />
      <XCircleIcon v-else class="w-5 h-5 shrink-0" />
      {{ message }}
      <button @click="$emit('dismiss')" class="ml-2 opacity-75 hover:opacity-100">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckCircleIcon, XCircleIcon, XMarkIcon } from '@heroicons/vue/24/solid'

defineProps<{ message: string; type: 'success' | 'error' }>()
defineEmits<{ dismiss: [] }>()
</script>
