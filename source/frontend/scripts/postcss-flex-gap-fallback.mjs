// PS5 WebKit only implements `gap` for Grid, not Flexbox. Backfill it with
// margin: negative on the container, positive on every child, both axes.

function negate(value) {
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

const SIMPLE_SELECTOR = /^\.[\w\\:./-]+$/

export default function flexGapFallback() {
  return {
    postcssPlugin: 'flex-gap-fallback',
    OnceExit(root, { rule, decl, atRule }) {
      const insertions = []

      root.walkRules((r) => {
        if (!SIMPLE_SELECTOR.test(r.selector)) return

        let display = null
        let rowGap = null
        let colGap = null
        r.walkDecls((d) => {
          if (d.prop === 'display') display = d.value
          else if (d.prop === 'gap') { rowGap = d.value; colGap = d.value }
          else if (d.prop === 'row-gap') rowGap = d.value
          else if (d.prop === 'column-gap') colGap = d.value
        })
        if (rowGap === null && colGap === null) return
        if (display === 'grid' || display === 'inline-grid') return // native gap already works

        // A rule with its own flex display keeps that selector; a bare gap-* utility
        // is assumed to pair with a separate .flex/.inline-flex class.
        const containers = display === 'flex' || display === 'inline-flex'
          ? [r.selector]
          : [`.flex${r.selector}`, `.inline-flex${r.selector}`]

        // Anchored to the original rule's source — otherwise these synthesized nodes
        // have nowhere to point a source map at, which Vite warns about at build time.
        const containerDecls = []
        const childDecls = []
        if (rowGap !== null) {
          containerDecls.push(decl({ prop: 'margin-top', value: negate(rowGap), source: r.source }))
          childDecls.push(decl({ prop: 'margin-top', value: rowGap, source: r.source }))
        }
        if (colGap !== null) {
          containerDecls.push(decl({ prop: 'margin-left', value: negate(colGap), source: r.source }))
          childDecls.push(decl({ prop: 'margin-left', value: colGap, source: r.source }))
        }

        // `gap` alone misreports — PS5 WebKit has it for Grid. aspect-ratio is
        // absent there entirely, so it's the reliable signal (same guard as below).
        const supportsGuard = atRule({
          name: 'supports',
          params: 'not (aspect-ratio: 1 / 1)',
          source: r.source,
          nodes: [
            rule({ selector: containers.join(', '), nodes: containerDecls, source: r.source }),
            rule({ selector: containers.map((s) => `${s} > *`).join(', '), nodes: childDecls, source: r.source }),
          ],
        })

        insertions.push({ after: r, nodes: [supportsGuard] })
      })

      for (const { after, nodes } of insertions) after.parent.insertAfter(after, nodes)
    },
  }
}
flexGapFallback.postcss = true
