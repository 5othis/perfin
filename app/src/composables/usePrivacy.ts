import { ref } from 'vue'

const privacy = ref(false)

export function usePrivacy() {
  function toggle() {
    privacy.value = !privacy.value
  }
  return { privacy, toggle }
}
