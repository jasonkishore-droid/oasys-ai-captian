// Checks that every dish in menu.js has dietary tags, that no tag is misspelt,
// and writes dietary-review.csv for the restaurant owner to sign off.
//   node scripts/check-dietary.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MENU } from '../src/menu.js'
import { DIETARY, CHECK, SECTION_SIDES, TAG_LABELS, dishDiet } from '../src/dietary.js'

// what the owner has already signed off (scripts/apply-dietary-review.mjs) is carried into the new sheet
const signoffFile = fileURLToPath(new URL('../src/dietary-signoff.json', import.meta.url))
const signoff = existsSync(signoffFile) ? JSON.parse(readFileSync(signoffFile, 'utf8')) : null
const errors = []
const names = new Set()
const rows = [['Section', 'Dish', 'Type', 'Dish tags', 'Sides tags', 'Allergens', 'Vegan', 'Jain', 'Jain if sides swapped', 'Question for chef', 'Correct? (Y/N)', 'Owner notes']]

const checkTags = (where, str) => {
  for (const t of str.split(/\s+/).filter(Boolean)) if (!(t in TAG_LABELS)) errors.push(`Unknown tag "${t}" in ${where}`)
}
for (const [sec, str] of Object.entries(SECTION_SIDES)) checkTags(`sides of ${sec}`, str)

for (const sec of MENU) {
  for (const [name, , type] of sec.items) {
    names.add(name)
    if (!(name in DIETARY)) { errors.push(`No tags for "${name}"`); continue }
    checkTags(name, DIETARY[name])
    const d = dishDiet(name, type, sec.title, signoff)
    const own = d.confirmed ? signoff.dishes[name] : DIETARY[name]
    const verdict = d.confirmed ? 'Y' : signoff?.needs_work?.[name] ? 'N' : ''
    if (type !== 'v' && (d.vegan || d.jain)) errors.push(`"${name}" is type ${type} but came out vegan/jain`)
    rows.push([sec.title, name, { v: 'Veg', e: 'Egg', n: 'Non-veg' }[type], own, signoff?.sides?.[sec.title] ?? SECTION_SIDES[sec.title] ?? '',
      d.allergens.join(' '), d.vegan ? 'Y' : '', d.jain ? 'Y' : '', d.jainWithoutSides && !d.jain ? 'Y' : '', d.check ?? '', verdict, signoff?.needs_work?.[name] ?? ''])
  }
}
for (const name of Object.keys(DIETARY)) if (!names.has(name)) errors.push(`Tags for "${name}", which is not on the menu`)
for (const name of Object.keys(CHECK)) if (!names.has(name)) errors.push(`Question for "${name}", which is not on the menu`)

const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')
const out = fileURLToPath(new URL('../dietary-review.csv', import.meta.url))
writeFileSync(out, '﻿' + csv) // BOM so Excel reads ₹ and Tamil names correctly

const count = (f) => rows.slice(1).filter(f).length
console.log(`${names.size} dishes, ${Object.keys(DIETARY).length} tagged, ${Object.keys(CHECK).length} questions for the chef`)
console.log(`Vegan: ${count((r) => r[6] === 'Y')}  Jain as served: ${count((r) => r[7] === 'Y')}  Jain if sides swapped: ${count((r) => r[8] === 'Y')}  Gluten-free (before hing check): ${count((r) => !r[5].includes('gluten'))}`)
console.log(signoff
  ? `Signed off by ${signoff.signed_by} on ${signoff.signed_at}: ${Object.keys(signoff.dishes).length} of ${names.size} dishes confirmed`
  : 'Not signed off yet: every dish is a draft (the tablet says so when filtering)')
console.log(`Review sheet: ${out}`)
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
