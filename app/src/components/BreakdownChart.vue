<template>
  <Doughnut :data="chartData" :options="chartOptions" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { ACCOUNT_TYPE_COLORS, ACCOUNT_TYPE_LABELS } from '@/types'
import type { AccountType } from '@/types'

ChartJS.register(ArcElement, Tooltip, Legend)

const props = defineProps<{ byType: Record<string, number> }>()

const chartData = computed(() => {
  const types = Object.keys(props.byType) as AccountType[]
  return {
    labels: types.map((t) => ACCOUNT_TYPE_LABELS[t] ?? t),
    datasets: [
      {
        data: types.map((t) => props.byType[t]),
        backgroundColor: types.map((t) => ACCOUNT_TYPE_COLORS[t] ?? '#9CA3AF'),
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' as const },
    tooltip: {
      callbacks: {
        label: (ctx: { label: string; parsed: number }) =>
          `${ctx.label}: ${ctx.parsed.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`,
      },
    },
  },
}
</script>
