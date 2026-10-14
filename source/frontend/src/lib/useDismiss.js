import { useCallback, useState } from 'react'

// Plays a quick reverse of the entrance animation before the caller unmounts a modal, instead
// of it vanishing mid-frame. Deliberately faster than the ~0.3s open — see .pmgr-modal-out in index.css.
const CLOSE_MS = 140

export function useDismiss(onClose) {
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, CLOSE_MS)
  }, [onClose])
  return { closing, close }
}
