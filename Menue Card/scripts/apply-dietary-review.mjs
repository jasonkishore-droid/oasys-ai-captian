// Records the restaurant owner's sign-off on the dietary and allergen tags.
//
// 1. `node scripts/check-dietary.mjs` writes dietary-review.csv.
// 2. The owner / head chef goes through it with the kitchen: for each dish, fix the "Dish tags"
//    column if needed, put Y in "Correct? (Y/N)" once it is right, or N with a note if it needs work.
// 3. `node scripts/apply-dietary-review.mjs dietary-review.csv --by "Owner's name"`
//    writes src/dietary-signoff.json. Only rows marked Y are confirmed; the tablet's dietary filters
//    treat every other dish as unconfirmed. Run it again with the updated sheet as more rows are done.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MENU } from '../src/menu.js'
import { SECTION_SIDES, TAG_LABELS } from '../src/dietary.js'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const by = flag('--by')?.trim()
const on = flag('--date')?.trim() || new Date().toISOString().slice(0, 10)
const outArg = flag('--out') // for trying it out without touching the real sign-off
const sheet = args[0]
if (!sheet || !by) {
  console.error('Usage: node scripts/apply-dietary-review.mjs <filled-in review.csv> --by "Name of who signed it off" [--date YYYY-MM-DD]')
  process.exit(2)
}

// a small CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes, a BOM
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell), rows.push(row), (row = []), (cell = '')
    } else cell += c
  }
  if (cell || row.length) row.push(cell), rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim()))
}

const [head, ...rows] = parseCsv(readFileSync(sheet, 'utf8').replace(/^﻿/, ''))
const col = (name) => {
  const i = head.findIndex((h) => h.trim().toLowerCase().startsWith(name.toLowerCase()))
  if (i < 0) throw new Error(`The sheet has no "${name}" column`)
  return i
}
const C = { section: col('Section'), dish: col('Dish'), tags: col('Dish tags'), sides: col('Sides tags'), ok: col('Correct?'), notes: col('Owner notes') }

const onMenu = new Map(MENU.flatMap((s) => s.items.map(([name]) => [name, s.title])))
const errors = []
const dishes = {}
const sides = {}
const needsWork = {}
let blank = 0
const cleanTags = (s, where) => {
  const tags = String(s || '').toLowerCase().split(/[\s,;]+/).filter(Boolean)
  for (const t of tags) if (!(t in TAG_LABELS)) errors.push(`${where}: unknown tag "${t}" (use ${Object.keys(TAG_LABELS).join(', ')})`)
  return [...new Set(tags)].join(' ')
}

for (const r of rows) {
  const name = r[C.dish]?.trim()
  const section = r[C.section]?.trim()
  if (!onMenu.has(name)) {
    errors.push(`"${name}" is not on the menu (was it renamed?)`)
    continue
  }
  const answer = (r[C.ok] || '').trim().toUpperCase()
  if (answer === 'Y' || answer === 'YES') {
    dishes[name] = cleanTags(r[C.tags], name)
    // the default sides are confirmed with the dishes they come with; they must agree within a section
    if (SECTION_SIDES[section] !== undefined) {
      const s = cleanTags(r[C.sides], `${name} (sides)`)
      if (sides[section] !== undefined && sides[section] !== s) errors.push(`${section}: the sides tags differ between rows ("${sides[section]}" and "${s}")`)
      sides[section] = s
    }
  } else if (answer === 'N' || answer === 'NO') needsWork[name] = (r[C.notes] || '').trim() || '(no note)'
  else blank++
}
const missing = [...onMenu.keys()].filter((n) => !rows.some((r) => r[C.dish]?.trim() === n))

if (errors.length) {
  console.error(`Nothing written. Fix these in ${sheet} first:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

const out = outArg || fileURLToPath(new URL('../src/dietary-signoff.json', import.meta.url))
const signoff = { signed_by: by, signed_at: on, sheet: sheet.replace(/\\/g, '/').split('/').pop(), dishes, sides, needs_work: needsWork }
writeFileSync(out, JSON.stringify(signoff, null, 2) + '\n')
console.log(`Signed off by ${by} on ${on}: ${Object.keys(dishes).length} of ${onMenu.size} dishes confirmed.`)
if (Object.keys(needsWork).length) console.log(`${Object.keys(needsWork).length} marked N (not confirmed): ${Object.keys(needsWork).join(', ')}`)
if (blank) console.log(`${blank} not reviewed yet (blank): not confirmed.`)
if (missing.length) console.log(`${missing.length} dishes are not in the sheet: not confirmed.`)
console.log(`Written: ${out}`)
