<template>
  <Line :data="chartData" :options="chartOptions" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { usePrivacy } from '@/composables/usePrivacy'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface DataPoint { date: string; total?: number; value?: number }

const props = defineProps<{ history: DataPoint[]; label?: string }>()
const { privacy } = usePrivacy()

const chartData = computed(() => ({
  labels: props.history.map((p) => p.date),
  datasets: [
    {
      label: props.label ?? 'Net Worth',
      data: props.history.map((p) => p.total ?? p.value ?? 0),
      borderColor: '#6366F1',
      backgroundColor: 'rgba(99,102,241,0.1)',
      borderWidth: 2,
      pointRadius: props.history.length <= 20 ? 4 : 2,
      fill: true,
      tension: 0.3,
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<'line'>) =>
          (ctx.parsed.y ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }),
      },
    },
  },
  scales: {
    y: {
      ticks: {
        color: privacy.value ? 'transparent' : '#6b7280',
        callback: function (val: number | string) {
          if (typeof val === 'number') {
            return val >= 1000 ? (val / 1000).toFixed(0) + 'k€' : val + '€'
          }
          return val
        },
      },
    },
  },
}))
</script>
