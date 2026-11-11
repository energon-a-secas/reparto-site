/**
 * Browser check: keyboard focus on every Footer Kit control wears Reparto's teal,
 * at 1440 and 390, and a visitor's ?theme= still takes it back.
 *
 * The custom header skin declares its tokens on .header-bar; the footer, the
 * back-to-top button and a disclaimer dialog sit outside it, so before the fix
 * they read the kit's :root magenta (#e879f9) and every footer ring was pink.
 * Not a node --test file: it needs Playwright's browsers and starts its own two
 * servers (reparto-site on FOCUS_PORT 9550, neorgon-site for the Workspace
 * frame on FOCUS_FRAME_PORT 9551), stopped on exit.
 *
 *   node projects/reparto-site/test/footer-focus-browser.mjs [chromium,firefox,webkit] [shotDir]
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(join(ROOT, 'package.json'))
const pw = require('playwright')

const TOOL_PORT = Number(process.env.FOCUS_PORT || 9550)
const FRAME_PORT = Number(process.env.FOCUS_FRAME_PORT || 9551)
const TOOL = `http://localhost:${TOOL_PORT}/`
const FRAME = `http://localhost:${FRAME_PORT}`
const engines = (process.argv[2] || 'chromium').split(',')
const shots = process.argv[3] || ''
const TEAL = 'rgb(94, 234, 212)'      // --header-accent of the custom skin, #5eead4
const FOCUS = 'rgb(45, 212, 191)'     // --header-focus of the custom skin, #2dd4bf (the Beacon link's ring)
const MAGENTA = 'rgb(232, 121, 249)'  // the kit's default, #e879f9
const PINK_FOCUS = 'oklch(0.97 0.02 320)'  // the kit's default --header-focus, #f2e9f4
const teal = r => r.color === (/neo-beacon-link/.test(r.what) ? FOCUS : TEAL)

let servers = []
const stop = () => { servers.forEach(s => s.kill()); servers = [] }
process.on('exit', stop)
async function up(port) {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`the server on ${port} never answered`)
}
servers = [[TOOL_PORT, 'projects/reparto-site'], [FRAME_PORT, 'projects/neorgon-site']]
  .map(([port, dir]) => spawn('python3', [join(ROOT, 'scripts/serve.py'), String(port), join(ROOT, dir)], { stdio: 'ignore' }))
await Promise.all([up(TOOL_PORT), up(FRAME_PORT)])

const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' ' + extra : ''}`) }

// Tab from the footer's own text through every footer control and the back-to-top
// button, recording each focused control's outline colour.
// WebKit follows macOS: Tab skips links unless Option is held, so it tabs with Alt+Tab.
async function footerRings(page, eng) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(400)
  const box = await page.locator('.neo-footer-note, .neo-footer-inner').first().boundingBox()
  await page.mouse.click(box.x + 2, box.y + 2)    // sets the sequential focus start, focuses nothing
  const rings = []
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || !(el.closest('.neo-footer') || el.classList.contains('neo-top'))) return null
      const cs = getComputedStyle(el)
      return { what: el.className || el.textContent.trim().slice(0, 20) || el.tagName, color: cs.outlineColor, style: cs.outlineStyle, fv: el.matches(':focus-visible') }
    })
    if (!r) { if (rings.length) break; else continue }
    rings.push(r)
  }
  return rings
}

for (const eng of engines) {
  const browser = await pw[eng].launch()
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addInitScript(([dev]) => { try { localStorage.setItem('neo-ws:dev-origin', dev) } catch { /* none */ } }, [FRAME])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${TOOL}?v=${Date.now()}`)
    await page.waitForSelector('.neo-footer-bar')
    await page.waitForTimeout(300)

    const rings = await footerRings(page, eng)
    const what = rings.map(r => `${r.what}:${r.color}`).join(' | ')
    const topShown = await page.evaluate(() => !!document.querySelector('.neo-top.is-visible'))
    check(`${eng} ${width}: Tab reaches the footer's controls (and back to top when shown)`, rings.length >= 3 && (!topShown || rings.some(r => /neo-top/.test(r.what))), what)
    check(`${eng} ${width}: every footer focus ring is Reparto's teal`, rings.length > 0 && rings.every(r => r.fv && r.style !== 'none' && teal(r)), what)
    check(`${eng} ${width}: no footer ring is the kit's magenta or pink`, !rings.some(r => r.color === MAGENTA || r.color === PINK_FOCUS), what)
    if (shots) await page.screenshot({ path: join(shots, `reparto-footer-focus-${eng}-${width}.png`) })

    // A visitor's theme still wins: the skin collapses and the footer follows the theme.
    await page.goto(`${TOOL}?theme=matrix&v=${Date.now()}`)
    await page.waitForSelector('.neo-footer-bar')
    await page.waitForTimeout(300)
    const themed = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      footer: getComputedStyle(document.querySelector('.neo-footer')).getPropertyValue('--footer-accent').trim(),
      root: getComputedStyle(document.documentElement).getPropertyValue('--header-accent').trim(),
    }))
    const tRings = await footerRings(page, eng)
    check(`${eng} ${width}: ?theme=matrix takes the footer off the teal`, themed.theme === 'matrix' && tRings.length > 0 && tRings.every(r => r.color !== TEAL), JSON.stringify(themed) + ' ' + tRings.map(r => r.color).join(' '))
    check(`${eng} ${width}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  await browser.close()
}

stop()
const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
