import { useEffect, useState } from 'react'

// Delays a fast-changing value (search box) before it triggers a re-render.
// PS5 has no JIT — re-filtering a whole grid per keystroke feels broken.
export function useDebouncedValue(value, delayMs = 150) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
