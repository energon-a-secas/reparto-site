/**
 * Browser check for Reparto's Workspace adoption, in Chromium, Firefox and
 * WebKit. Not a node --test file: it needs Playwright's browsers and two local
 * servers, which it starts itself:
 *   reparto-site on REPARTO_PORT (9362), the tool;
 *   neorgon-site on WS_FRAME_PORT (9363), the frame and the Workspace page.
 *
 *   node projects/reparto-site/test/workspace-browser.mjs [chromium,firefox,webkit]
 *
 * Playwright turns Chromium's storage partitioning off and sets Firefox's
 * cookieBehavior to 4; both are put back to the browsers' defaults here, as in
 * the kit's own check, or a sharing check passes for the wrong reason.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(join(ROOT, 'package.json'))
const { chromium, firefox, webkit } = require('playwright')
const W = await import('../js/neorgon-workspace-core.js')

const TOOL_PORT = Number(process.env.REPARTO_PORT || 9362)
const FRAME_PORT = Number(process.env.WS_FRAME_PORT || 9363)
const servers = [[TOOL_PORT, 'projects/reparto-site'], [FRAME_PORT, 'projects/neorgon-site']]
  .map(([port, dir]) => spawn('python3', [join(ROOT, 'scripts/serve.py'), String(port), join(ROOT, dir)], { stdio: 'ignore' }))
const stop = () => servers.forEach(s => s.kill())
process.on('exit', stop)
await new Promise(r => setTimeout(r, 800))

const TOOL = `http://localhost:${TOOL_PORT}/`
const FRAME = `http://localhost:${FRAME_PORT}`
const engines = (process.argv[2] || 'chromium,firefox,webkit').split(',')
let v = Date.now() % 100000
const results = []
const check = (eng, name, ok, extra = '') => { results.push({ eng, name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${eng}: ${name}${extra && !ok ? ' ' + extra : ''}`) }

// A workspace with a hostile team name and person name: both must arrive as text.
const WS = W.normalizeWorkspace({
  v: 1,
  me: { person: 'ana-rojas' },
  people: [
    { id: 'ana-rojas', name: 'Ana Rojas', title: 'Backend', country: 'CL', load: 80 },
    { id: 'bruno-silva', name: '<img src=x onerror="window.__pwned=1">', country: 'MX', color: '#be185d' },
    { id: 'zoe', name: 'Zoe Park', country: 'US' },
  ],
  teams: [
    { id: 'payments', name: 'Payments <b>x</b>', members: [{ person: 'ana-rojas' }, { person: 'bruno-silva', pct: 50 }] },
    { id: 'growth', name: 'Growth', members: [{ person: 'zoe' }] },
  ],
}).ws

async function launch(eng) {
  if (eng === 'chromium') {
    const probe = await chromium.launch({ args: ['--enable-automation'] })
    const cdp = await probe.newBrowserCDPSession()
    const cmd = (await cdp.send('Browser.getBrowserCommandLine')).arguments.join(' ')
    await probe.close()
    const arg = (cmd.match(/--disable-features=\S+/) || [])[0]
    if (!arg) return chromium.launch()
    const kept = arg.replace(/(,)?ThirdPartyStoragePartitioning/, '').replace('=,', '=')
    return chromium.launch({ ignoreDefaultArgs: [arg], args: [kept] })
  }
  if (eng === 'firefox') return firefox.launch({ firefoxUserPrefs: { 'network.cookie.cookieBehavior': 5 } })
  return webkit.launch()
}

async function go(page, url) {
  for (let i = 0; ; i++) {
    try { return await page.goto(url) } catch (err) {
      if (i >= 3 || !/connect|CONNECTION_REFUSED|NS_ERROR_NET|reset/i.test(String(err))) throw err
      await page.waitForTimeout(400)
    }
  }
}

async function seedFrame(ctx) {
  const stamp = W.makeStamp()
  const p = await ctx.newPage()
  await go(p, `${FRAME}/workspace/vault.html?v=${++v}`)
  await p.evaluate(([rec, cookie]) => { localStorage.setItem('neo-ws:workspace', JSON.stringify(rec)); document.cookie = cookie },
    [{ __v: W.STORE_VERSION, data: { stamp, ws: WS } }, W.stampCookie(stamp, { protocol: 'http:', hostname: 'localhost' })])
  await p.close()
}

const team = page => page.evaluate(async () => { const m = await import('/js/workspace-ui.js'); const t = m.workspace().team(); return { status: t.status, frame: t.frame, people: t.ws ? t.ws.people.length : 0 } })
async function waitTeam(page, ms = 7000) {
  const end = Date.now() + ms
  let t
  while (Date.now() < end) { t = await team(page).catch(() => null); if (t && t.people && t.frame !== 'pending') return t; await page.waitForTimeout(100) }
  return t
}
const doc = page => page.evaluate(() => JSON.parse(localStorage.getItem('reparto-v1')).doc)

for (const eng of engines) {
  const browser = await launch(eng)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const requests = []
  ctx.on('request', r => requests.push(r.url()))
  await ctx.addInitScript(([dev]) => { try { if (location.port !== dev.split(':').pop()) localStorage.setItem('neo-ws:dev-origin', dev) } catch { /* none */ } }, [FRAME])
  await seedFrame(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await go(page, `${TOOL}?v=${++v}`)

  // 1. The gear and the , key; Escape gives focus back to the gear.
  await page.waitForSelector('.neo-ws-gear')
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press(',')
  const open = await page.waitForSelector('dialog[open]', { timeout: 3000 }).then(() => true, () => false)
  check(eng, ', opens the Settings sheet', open)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check(eng, 'Escape returns focus to the gear', await page.evaluate(() => document.activeElement?.classList.contains('neo-ws-gear')))

  // 2. The team arrives through the frame (or the cache) and Reparto's section offers its teams, yours first.
  const t = await waitTeam(page)
  check(eng, 'the workspace team is read', !!(t && t.people === 3), JSON.stringify(t))
  await page.click('.neo-ws-gear')
  await page.waitForSelector('#wsTeamPick')
  const pick = await page.evaluate(() => ({ value: document.getElementById('wsTeamPick').value, labels: [...document.querySelectorAll('#wsTeamPick option')].map(o => o.textContent), h: document.getElementById('wsTeamPick').offsetHeight }))
  check(eng, 'the section offers your team first, names as text', pick.value === 'payments' && pick.labels[0].startsWith('Payments <b>x</b>'), JSON.stringify(pick))
  check(eng, 'the team picker is 44px tall', pick.h >= 44, String(pick.h))

  // 3. New plan from my team: a plan of its own, people with countries and load, faces from the kit.
  await page.getByRole('dialog').getByRole('button', { name: 'New plan from my team' }).click()
  await page.waitForTimeout(400)
  const d = await doc(page)
  check(eng, 'New plan from my team opens the team as a plan', d.title === 'Payments <b>x</b>' && d.people.length === 2 && d.people[0].load === 80 && d.people[1].load === 50 && d.people[1].country === 'MX', JSON.stringify(d.people))
  const faces = await page.evaluate(() => [...document.querySelectorAll('#rosterList .face')].map(f => getComputedStyle(f).backgroundColor))
  check(eng, 'the workspace colour reaches the face', faces.includes('rgb(190, 24, 93)'), JSON.stringify(faces))
  check(eng, 'hostile names stay text', await page.evaluate(() => !window.__pwned && !document.querySelector('main img[src="x"]') && document.getElementById('rosterList').textContent.includes('<img')))
  check(eng, 'the plan is listed as from your workspace', await page.evaluate(() => document.getElementById('planList').textContent.includes('from your workspace')))

  // 4. A blank plan takes work days and week start from your settings.
  await page.evaluate(([c]) => { document.cookie = c }, [W.meCookie({ d: '1234', w: 7 }, { protocol: 'http:', hostname: 'localhost' })])
  await page.evaluate(() => document.querySelector('#plansMenu [data-action="blank"]').click())
  await page.waitForTimeout(300)
  const b = await doc(page)
  check(eng, 'a blank plan follows your work days and week start', b.settings.daysPerWeek === 4 && new Date(b.settings.startDate + 'T00:00:00Z').getUTCDay() === 0, JSON.stringify(b.settings))
  const offer = await page.evaluate(() => !document.getElementById('wsOffer').hidden && !document.getElementById('wsBanner').hidden)
  check(eng, 'an empty plan offers your team', offer)

  // 5. Save: to the Workspace page's review, with the plan's people, tool and return.
  await page.evaluate(() => document.querySelector('#plansMenu [data-action="switch-plan"]:not([aria-checked="true"])')?.click())
  await page.waitForTimeout(200)
  await page.click('.neo-ws-gear')
  await page.getByRole('dialog').getByRole('button', { name: /Save this plan's people/ }).click()
  await page.waitForURL(/#save=/, { timeout: 5000 }).catch(() => {})
  const saved = W.parseFragment(new URL(page.url()).hash)
  check(eng, 'save goes to the Workspace review', !!(saved && saved.op === 'save' && saved.tool === 'reparto' && page.url().startsWith(FRAME + '/workspace/')), page.url().slice(0, 120))
  const back = W.previewPayload(WS, saved ? saved.payload : '')
  check(eng, 'the review adds nobody already there', !!(back && back.added.length === 0), JSON.stringify(back && back.added))

  // 6. The pick round trip through the real page: the answer is read, cached and stripped; no request carries it.
  await go(page, `${TOOL}#keep-me`)
  await page.waitForSelector('.neo-ws-gear')
  await page.evaluate(async () => (await import('/js/workspace-ui.js')).workspace().load())
  await page.waitForURL(/#pick/, { timeout: 5000 })
  await page.getByRole('button', { name: /Share with Reparto/ }).click()
  await page.waitForURL(u => u.toString().startsWith(TOOL), { timeout: 5000 })
  await page.waitForSelector('.neo-ws-gear')
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => location.hash)
  check(eng, 'a pick comes back, stripped, with the tool fragment restored', after === '#keep-me' || after === '', after)
  check(eng, 'no request carries the team', !requests.some(u => u.includes('neo-ws=') && !u.startsWith(FRAME)), requests.filter(u => u.includes('neo-ws=')).join(' '))

  // 7. Nothing under 12px for reading text, at phone width too.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(150)
    const small = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('main *, .modal *, .pop *')) {
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
        if (el.closest('.sr-only, [hidden], svg')) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 12) out.push(`${el.className || el.tagName}:${fs}`)
      }
      return out.slice(0, 8)
    })
    check(eng, `nothing under 12px at ${width}`, small.length === 0, small.join(' '))
  }
  check(eng, 'no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
}

stop()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} passed`)
process.exit(failed.length ? 1 : 0)
