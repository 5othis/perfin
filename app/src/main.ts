import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { initDatabase } from '@/db/database'
import { useFinanceStore } from '@/stores/finance'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(router)

initDatabase().then(() => {
  const store = useFinanceStore()
  store.loadFromDb()
  app.mount('#app')
}).catch((err) => {
  console.error('Failed to initialize database:', err)
  document.body.innerHTML = `<div style="font-family:monospace;padding:2rem;color:red">
    <b>Database init failed</b><br><pre>${err}</pre>
  </div>`
})
