import { useSocketStore } from './stateStore'

// Shown until the server's first `system_mode` frame arrives (it follows the initial
// fires snapshot on every connect), and after logout clears the socket store.
const OFF = { enabled: false, since: null, by: null }

/**
 * Current Test-mode state, as pushed by the server's `system_mode` WebSocket frame
 * (sent on connect and whenever an admin switches the mode on any API replica).
 * While on, every fire the console sees is a drill copy, kept apart from real data.
 * @returns {{enabled: boolean, since: string|null, by: string|null}}
 */
export function useTestMode() {
  return useSocketStore((s) => s.byType.system_mode) ?? OFF
}
