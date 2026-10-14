// Pure message-formatting logic (key resolution, interpolation, ICU-ish plural branches) —
// split out of i18n.jsx so scripts/test-i18n.mjs can import it in plain Node without JSX/React.

export function resolveKey(dict, key) {
  let node = dict
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

export function interpolate(template, vars) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}

// A small ICU-like subset. Brace-aware rather than a regex: `[^}]+` stops at the first
// '}' and leaks the rest into the UI when a branch body contains its own braces.
const PLURAL_HEAD_RE = /^\{(\w+),\s*plural,\s*/
const PLURAL_PRESENT_RE = /,\s*plural\s*,/
const BRANCH_HEAD_RE = /\s*(zero|one|two|few|many|other)\s*\{/y

// Index of the '}' that closes the '{' at `text[openIndex]`, tracking depth so nested `{...}`
// doesn't end the scan early. -1 if braces never balance (caller leaves it untouched).
function matchingBraceEnd(text, openIndex) {
  let depth = 1
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// Parses "one {...} other {...}" (any order, any subset of the six ICU
// plural categories) into { category: branchBody }.
function parsePluralBranches(branchesText) {
  const branches = {}
  let cursor = 0
  while (cursor < branchesText.length) {
    BRANCH_HEAD_RE.lastIndex = cursor
    const head = BRANCH_HEAD_RE.exec(branchesText)
    if (!head || head.index !== cursor) break
    const openIndex = BRANCH_HEAD_RE.lastIndex - 1
    const closeIndex = matchingBraceEnd(branchesText, openIndex)
    if (closeIndex === -1) break
    branches[head[1]] = branchesText.slice(openIndex + 1, closeIndex)
    cursor = closeIndex + 1
  }
  return branches
}

// `vars.count` selects the branch via Intl.PluralRules — never assume one/other only, Arabic/
// Polish/Russian/Ukrainian use more. Missing category falls back to "other"; `#` becomes the locale count.
export function resolvePlurals(template, vars, locale) {
  if (!vars || !PLURAL_PRESENT_RE.test(template)) return template
  const rules = new Intl.PluralRules(locale)
  const numberFormat = new Intl.NumberFormat(locale)

  let out = ''
  let i = 0
  while (i < template.length) {
    if (template[i] === '{') {
      const head = PLURAL_HEAD_RE.exec(template.slice(i))
      const closeIndex = head ? matchingBraceEnd(template, i) : -1
      if (head && closeIndex !== -1) {
        const varName = head[1]
        const count = vars[varName]
        if (typeof count === 'number') {
          const branches = parsePluralBranches(template.slice(i + head[0].length, closeIndex))
          const chosen = branches[rules.select(count)] ?? branches.other ?? ''
          out += chosen.replace(/#/g, numberFormat.format(count))
        } else {
          out += template.slice(i, closeIndex + 1) // count missing — leave the raw block as-is
        }
        i = closeIndex + 1
        continue
      }
    }
    out += template[i]
    i++
  }
  return out
}

// Full t()-equivalent pipeline for a raw template string — resolves plural blocks first, then
// interpolates the remaining {placeholder}s. Used by both i18n.jsx's t() and scripts/test-i18n.mjs.
export function formatMessage(template, vars, locale) {
  return interpolate(resolvePlurals(template, vars, locale), vars)
}
