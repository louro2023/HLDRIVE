import { useEffect } from 'react'

// Keep Prospero's controls and dialog Escape/Tab handling; add directional focus.
export function useConsoleNavigation() {
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('console')) return
    document.body.classList.add('hldrive-console')
    const selector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
    const targets = () => {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(e => e.getClientRects().length)
      return [...(dialogs.pop() || document).querySelectorAll(selector)].filter(e => e.getClientRects().length && !e.closest('[hidden], [inert]'))
    }
    function move(key) {
      const items = targets(), current = document.activeElement
      let next = items[0]
      if (items.includes(current)) {
        const r = current.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
        const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
        const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
        let best = Infinity
        next = current
        for (const item of items) {
          if (item === current) continue
          const b = item.getBoundingClientRect(), dx = b.left + b.width / 2 - x, dy = b.top + b.height / 2 - y
          const forward = (horizontal ? dx : dy) * sign, side = Math.abs(horizontal ? dy : dx)
          const score = forward + side * 3
          if (forward > 2 && score < best) { best = score; next = item }
        }
      }
      next?.focus()
      next?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    function keyboard(e) {
      if (!e.key.startsWith('Arrow') || e.altKey || e.ctrlKey || e.metaKey) return
      // Native editing/select menus retain their arrows; Tab leaves the field.
      if (e.target.matches('input:not([type="checkbox"]),textarea,select')) return
      e.preventDefault(); e.stopImmediatePropagation(); move(e.key)
    }
    const escape = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))
    let frame, previous = [], lastDirection = '', nextRepeat = 0
    function poll(time) {
      const pad = navigator.getGamepads && [...navigator.getGamepads()].find(p => p && p.mapping === 'standard')
      if (pad) {
        const pressed = pad.buttons.map(b => b.pressed)
        const direction = pressed[12] ? 'ArrowUp' : pressed[13] ? 'ArrowDown' : pressed[14] ? 'ArrowLeft' : pressed[15] ? 'ArrowRight' : ''
        if (direction && (direction !== lastDirection || time >= nextRepeat)) {
          move(direction); nextRepeat = time + (direction !== lastDirection ? 350 : 140)
        }
        lastDirection = direction
        if (pressed[0] && !previous[0]) document.activeElement?.click()
        if (pressed[1] && !previous[1]) escape()
        previous = pressed
      } else { previous = []; lastDirection = '' }
      frame = requestAnimationFrame(poll)
    }
    document.addEventListener('keydown', keyboard, true)
    frame = requestAnimationFrame(poll)
    targets()[0]?.focus()
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keyboard, true); document.body.classList.remove('hldrive-console') }
  }, [])
}
