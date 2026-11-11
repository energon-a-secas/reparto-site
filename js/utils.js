// ── Shared utilities ─────────────────────────────────────────
// Small, pure helpers used across modules.

/** Element by id. Re-looks-up an element that is no longer in the document. */
const _els = {}
export function $(id) {
  const el = _els[id]
  if (el && el.isConnected) return el
  return (_els[id] = document.getElementById(id))
}

export function escHtml(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let _toastTimer = null
export function showToast(msg) {
  let el = document.getElementById('app-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'app-toast'
    el.className = 'toast'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('visible')
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 2600)
}

/** Display only. Saved names, table rows and exports always retain the original. */
export function compactName(name) {
  const [first, second] = String(name || '').trim().split(/\s+/)
  return first ? `${first}${second ? ` ${Array.from(second)[0].toLocaleUpperCase()}.` : ''}` : 'Unnamed'
}

/** A share's percentage as the page shows it: whole numbers, one decimal under 10%. */
export const fmtPct = p => `${p < 10 && !Number.isInteger(p) ? Math.round(p * 10) / 10 : Math.round(p)}%`

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export const slug = s => String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'
