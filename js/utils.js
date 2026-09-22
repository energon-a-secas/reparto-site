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

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Display only. Saved names, table rows and exports always retain the original. */
export function compactName(name) {
  const [first, second] = String(name || '').trim().split(/\s+/)
  return first ? `${first}${second ? ` ${Array.from(second)[0].toLocaleUpperCase()}.` : ''}` : 'Unnamed'
}

// Face discs: eight hues at one lightness, keyed on the person's id so a
// colour follows the person, never their position in the list. The name is
// always printed beside the disc, so colour is never the only cue.
const FACES = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be185d', '#15803d', '#0369a1', '#9f1239']
export function faceColor(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FACES[h % FACES.length]
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
