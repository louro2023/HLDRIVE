import { useCallback, useEffect, useRef, useState } from 'react'

const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 6

function computePosition(triggerEl, menuEl, align) {
  const trigger = triggerEl.getBoundingClientRect()
  const menuHeight = menuEl?.offsetHeight || 0
  const menuWidth = menuEl?.offsetWidth || 0
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth

  const spaceBelow = viewportH - trigger.bottom - TRIGGER_GAP - VIEWPORT_MARGIN
  const spaceAbove = trigger.top - TRIGGER_GAP - VIEWPORT_MARGIN
  const openUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow

  let top = openUpward ? trigger.top - TRIGGER_GAP - menuHeight : trigger.bottom + TRIGGER_GAP
  const maxTop = viewportH - VIEWPORT_MARGIN - Math.min(menuHeight, viewportH - 2 * VIEWPORT_MARGIN)
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxTop))

  let left = align === 'right' ? trigger.right - menuWidth : trigger.left
  const maxLeft = viewportW - VIEWPORT_MARGIN - Math.min(menuWidth, viewportW - 2 * VIEWPORT_MARGIN)
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxLeft))

  return { top, left, openUpward, maxHeight: viewportH - 2 * VIEWPORT_MARGIN }
}

// Shared anchored-popover placement — "open below, flip above if it doesn't fit, clamp to
// viewport" for ActionMenu and the language picker. Call measure() once the menu has actually rendered.
export function useAnchoredPosition(active) {
  const [pos, setPos] = useState(null)
  const lastArgs = useRef(null)

  const measure = useCallback((triggerEl, menuEl, align = 'right') => {
    if (!triggerEl) return
    lastArgs.current = { triggerEl, menuEl, align }
    setPos(computePosition(triggerEl, menuEl, align))
  }, [])

  useEffect(() => {
    if (!active) {
      setPos(null)
      lastArgs.current = null
      return undefined
    }
    const remeasure = () => {
      const args = lastArgs.current
      if (args?.triggerEl) setPos(computePosition(args.triggerEl, args.menuEl, args.align))
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('orientationchange', remeasure)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('orientationchange', remeasure)
    }
  }, [active])

  return { pos, measure }
}
