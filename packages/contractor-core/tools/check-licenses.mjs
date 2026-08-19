/**
 * Contractor-core dependency license gate.
 *
 * Reads the license field of every dependency installed in
 * packages/contractor-core/node_modules and validates it against the
 * permissive allowlist (same as the fork's tools/check-licenses.mjs).
 *
 * Run: node packages/contractor-core/tools/check-licenses.mjs
 *
 * Exits non-zero on any disallowed or missing license. This ensures future
 * contractor-core dependency additions cannot bypass license checking.
 * (Phase 1.1 license-gate fix for audit finding M2.)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const NM = join(ROOT, 'node_modules')

const ALLOWED = new Set([
  'MIT', 'MIT-0', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'CC-BY-4.0', 'Zlib', 'Unlicense',
  'Python-2.0', 'Unicode-3.0', 'OFL-1.1',
])

const EXCEPTIONS = {}

function isAllowed(expr) {
  let s = String(expr).trim()
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  const orParts = splitTop(s, ' OR ')
  if (orParts.length > 1) return orParts.some(isAllowed)
  const andParts = splitTop(s, ' AND ')
  if (andParts.length > 1) return andParts.every(isAllowed)
  const slashParts = s.includes('/') ? s.split('/') : [s]
  if (slashParts.length > 1) return slashParts.some(isAllowed)
  const withParts = s.split(' WITH ')
  return ALLOWED.has(withParts[0].trim())
}

function splitTop(s, sep) {
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i <= s.length - sep.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i)); start = i + sep.length; i += sep.length - 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

if (!existsSync(NM)) {
  console.error('No node_modules at ' + NM + '. Run npm install in packages/contractor-core first.')
  process.exit(1)
}

const violations = []
let checked = 0

for (const entry of readdirSync(NM)) {
  if (entry.startsWith('.')) continue
  const scoped = entry.startsWith('@')
  const scopeDir = join(NM, entry)
  if (scoped) {
    for (const sub of readdirSync(scopeDir)) {
      const pkgJsonPath = join(scopeDir, sub, 'package.json')
      if (!existsSync(pkgJsonPath)) continue
      checkPkg('@' + entry + '/' + sub, pkgJsonPath)
    }
  } else {
    const pkgJsonPath = join(scopeDir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    checkPkg(entry, pkgJsonPath)
  }
}

function checkPkg(name, pkgJsonPath) {
  checked++
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    return
  }
  const license = pkg.license || EXCEPTIONS[name]
  if (!license) {
    violations.push(name + ': no license field in package.json')
    return
  }
  if (!isAllowed(license)) {
    violations.push(name + ': ' + license)
  }
}

console.log('Checked ' + checked + ' packages in packages/contractor-core/node_modules.')
if (violations.length > 0) {
  console.error('\nDisallowed or missing licenses in contractor-core dependencies:\n')
  for (const v of violations) console.error('  ' + v)
  console.error('\nAllowlist: see packages/contractor-core/tools/check-licenses.mjs.')
  process.exit(1)
}
console.log('All contractor-core dependency licenses are within the allowlist.')
