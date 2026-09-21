// Regenerate data/holidays/ from the date-holidays package.
//
// The site never loads a holiday library or calls a holiday API: this script
// runs once, locally, and writes one small JSON file per country with every
// nationwide public holiday for the years below. Rerun it to extend them.
//
//   npm install --prefix "$TMPDIR/hd" date-holidays@3
//   NODE_PATH="$TMPDIR/hd/node_modules" node tools/build-holidays.cjs
//
// Data: date-holidays (https://github.com/commenthol/date-holidays), code ISC,
// holiday data CC BY 3.0. The attribution lives in the site footer and README.

const fs = require('fs')
const path = require('path')
const Holidays = require('date-holidays')
const pkg = require('date-holidays/package.json')

const YEARS = [2025, 2026, 2027, 2028, 2029, 2030]

// Beyond the public list, two kinds of day a planner asks about, tagged so the
// page can say what they are and offer to work them all in one click:
//   bridge        Argentina's decreed non-working days (bridge days, tourism
//                 days). date-holidays types them bank or optional, not
//                 public; they are counted as days off, like the decree says.
//                 They are set a year at a time, so later years have none yet.
//   often-worked  US federal holidays many private employers work.
const EXTRA = { AR: /Bridge Day|Non-Working Day/ }
const OFTEN_WORKED = { US: /^(Columbus Day|Veterans Day)/ }
// English names date-holidays spells the British way for the US.
const RENAME = { US: { 'Labour Day': 'Labor Day' } }
const OUT = path.join(__dirname, '..', 'data', 'holidays')

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

fs.mkdirSync(OUT, { recursive: true })
const countries = new Holidays().getCountries('en')
const index = []

for (const [code, name] of Object.entries(countries)) {
  const en = new Holidays(code)
  const lang = en.getLanguages()[0] || 'en'
  const years = {}
  let count = 0
  const tags = {}
  for (const y of YEARS) {
    const local = new Map(en.getHolidays(y, lang).map(h => [`${h.date}|${h.rule}`, h.name]))
    const rows = []
    for (const h of en.getHolidays(y, 'en')) {
      const bridge = h.type !== 'public' && EXTRA[code]?.test(h.name)
      if (h.type !== 'public' && !bridge) continue
      const day = h.date.slice(0, 10)
      const span = Math.max(1, Math.round((h.end - h.start) / 86400000))
      const name = RENAME[code]?.[h.name] || h.name
      const native = local.get(`${h.date}|${h.rule}`) || h.name
      for (let i = 0; i < span; i++) {
        const date = addDays(day, i)
        rows.push([date, name, native === name ? undefined : native].filter(Boolean))
        if (bridge) tags[date] = 'bridge'
        else if (OFTEN_WORKED[code]?.test(h.name)) tags[date] = 'often-worked'
      }
    }
    // One entry per day: two rules can land on the same date.
    const seen = new Set()
    years[y] = rows.filter(r => !seen.has(r[0]) && seen.add(r[0])).sort((a, b) => a[0].localeCompare(b[0]))
    count += years[y].length
  }
  if (!count) continue
  const out = { country: code, name, source: `date-holidays ${pkg.version}`, years }
  if (Object.keys(tags).length) out.tags = tags
  fs.writeFileSync(path.join(OUT, `${code}.json`), JSON.stringify(out))
  index.push({ code, name })
}

index.sort((a, b) => a.name.localeCompare(b.name))
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ source: `date-holidays ${pkg.version}`, license: 'CC BY 3.0', years: YEARS, countries: index }))
console.log(`${index.length} countries, ${YEARS[0]} to ${YEARS[YEARS.length - 1]}, written to ${path.relative(process.cwd(), OUT)}`)
