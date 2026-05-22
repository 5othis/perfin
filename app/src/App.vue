<template>
  <div class="min-h-screen flex flex-col">
    <AppNavbar />
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
      <RouterView />
    </main>
    <ToastNotification v-if="toast.visible" :message="toast.message" :type="toast.type" @dismiss="toast.visible = false" />
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { RouterView } from 'vue-router'
import AppNavbar from '@/components/AppNavbar.vue'
import ToastNotification from '@/components/ToastNotification.vue'
import { provide } from 'vue'

const toast = reactive({ visible: false, message: '', type: 'success' as 'success' | 'error' })

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.message = message
  toast.type = type
  toast.visible = true
  setTimeout(() => { toast.visible = false }, 3000)
}

provide('showToast', showToast)
</script>
