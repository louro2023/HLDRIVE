#!/usr/bin/env node
// Checks every locale's keys against en-US.json (the canonical set).
// Exits non-zero on any mismatch, so it fails the build early.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = path.join(__dirname, '..', 'src', 'locales')
const CANONICAL = 'en-US.json'

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, fullKey, out)
    } else {
      out[fullKey] = value
    }
  }
  return out
}

function loadJson(file) {
  const raw = readFileSync(path.join(LOCALES_DIR, file), 'utf8')
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`invalid JSON in ${file}: ${e.message}`)
  }
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).sort()
if (!files.includes(CANONICAL)) {
  console.error(`Canonical locale ${CANONICAL} not found in ${LOCALES_DIR}`)
  process.exit(1)
}

let ok = true
let canonicalKeys

try {
  canonicalKeys = new Set(Object.keys(flatten(loadJson(CANONICAL))))
} catch (e) {
  console.error(String(e.message))
  process.exit(1)
}

console.log(`Canonical (${CANONICAL}): ${canonicalKeys.size} keys\n`)

for (const file of files) {
  if (file === CANONICAL) continue

  let data
  try {
    data = loadJson(file)
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`)
    ok = false
    continue
  }

  const keys = new Set(Object.keys(flatten(data)))
  const missing = [...canonicalKeys].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !canonicalKeys.has(k))

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${file}: complete (${keys.size} keys)`)
    continue
  }

  ok = false
  console.error(`✗ ${file}: ${keys.size} keys`)
  if (missing.length) {
    console.error(`  missing (${missing.length}):`)
    for (const k of missing) console.error(`    - ${k}`)
  }
  if (extra.length) {
    console.error(`  unexpected (${extra.length}):`)
    for (const k of extra) console.error(`    + ${k}`)
  }
}

console.log('')
if (!ok) {
  console.error('check:i18n FAILED — fix the issues above.')
  process.exit(1)
}
console.log(`check:i18n passed — all ${files.length} locales match ${CANONICAL}.`)
