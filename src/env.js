export const port = Number(process.env.PORT) || 3000

// API domain failover chain — tried in order until one responds
export const API_DOMAINS = [
  'ppv.st',   // primary
  'ppv.cx',   // failover 1
  'ppv.to',   // failover 2
  'ppv.is',   // failover 3
  'ppv.lc',   // failover 4
]

export const API_BASE = `https://api.${API_DOMAINS[0]}/api`

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

/**
 * Get the next API base to try after a failure.
 * @param {string} currentBase - The base that just failed
 * @returns {string|null} Next base to try, or null if all exhausted
 */
export function getNextApiBase(currentBase) {
  const currentIndex = API_DOMAINS.findIndex(d => currentBase.includes(d))
  if (currentIndex === -1 || currentIndex >= API_DOMAINS.length - 1) {
    return null
  }
  return `https://api.${API_DOMAINS[currentIndex + 1]}/api`
}

/**
 * Get all API bases in failover order.
 * @returns {string[]} Array of API base URLs
 */
export function getAllApiBases() {
  return API_DOMAINS.map(d => `https://api.${d}/api`)
}