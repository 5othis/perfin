import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import SnapshotView from '@/views/SnapshotView.vue'
import HistoryView from '@/views/HistoryView.vue'
import AccountsView from '@/views/AccountsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/snapshot', name: 'snapshot', component: SnapshotView },
    { path: '/history', name: 'history', component: HistoryView },
    { path: '/accounts', name: 'accounts', component: AccountsView },
  ],
})

export default router
