// Direct-install WebSocket uploader: streams a local .pkg straight into the backend's
// RAM cache (pkg_ws_upload.cpp) so nothing lands on PS5 storage — see pkg_live_cache.hpp.

const SEG_SIZE = 1024 * 1024
const BUSY_RETRY_MS = 50
// Segments kept in flight at once — stop-and-wait (1) caps throughput at one segment
// per round trip; a window overlaps sending with the ack round trip instead.
const WINDOW = 8

// Module scope, not component state — the install outlives the view that started it.
let activeSocket = null
const activeListeners = new Set()

function setActive(active) {
  for (const cb of activeListeners) cb(active)
}

// True from upload start until the backend closes the socket, well after "complete" —
// lets a caller warn the user not to close the tab early.
export function watchDirectUploadActive(cb) {
  activeListeners.add(cb)
  cb(activeSocket !== null)
  return () => activeListeners.delete(cb)
}

function wsUrl() {
  return `ws://${location.hostname}:9046/ws/upload`
}

function cancelBeacon() {
  try {
    navigator.sendBeacon('/api/pkg/direct/cancel')
  } catch {
    /* best effort */
  }
}

// The install still needs this connection for resends after the tab moves on — warn
// before an accidental close, and tell the backend right away on an actual one.
window.addEventListener('beforeunload', (e) => {
  if (!activeSocket) return
  e.preventDefault()
  e.returnValue = ''
})
window.addEventListener('pagehide', () => {
  if (activeSocket) cancelBeacon()
})

export function directUploadPkg(file, onProgress) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl())
    ws.binaryType = 'arraybuffer'
    activeSocket = ws
    setActive(true)

    const segCount = Math.ceil(file.size / SEG_SIZE)
    const ackedOnce = new Set()
    const inFlight = new Set() // baseline segments sent but not yet acked
    let nextToSend = 0
    let finishSent = false
    let settled = false
    let sendChain = Promise.resolve()

    const settle = (fn) => {
      if (settled) return
      settled = true
      fn()
    }

    // FileReader, not Blob.arrayBuffer() — present but slow/unreliable on the PS5's
    // WebKit build, so it's never used even when the browser reports it exists.
    const segmentBytes = (index) => {
      const start = index * SEG_SIZE
      const blob = file.slice(start, Math.min(start + SEG_SIZE, file.size))
      return new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result)
        reader.onerror = () => rej(reader.error)
        reader.readAsArrayBuffer(blob)
      })
    }

    // Reads for the whole window start immediately and run concurrently — only the
    // wire sends are serialized, so disk I/O overlaps instead of gating one at a time.
    const prepared = new Map()
    const prepare = (index) => {
      if (!prepared.has(index)) prepared.set(index, segmentBytes(index))
      return prepared.get(index)
    }

    const enqueueSegment = (index) => {
      const read = prepare(index)
      sendChain = sendChain
        .then(() => read)
        .then((buf) => {
          prepared.delete(index)
          if (ws.readyState !== WebSocket.OPEN) return
          ws.send(JSON.stringify({ op: 'seg', seg: index }))
          ws.send(buf)
        })
        .catch((err) => settle(() => reject(err instanceof Error ? err : new Error('could not read the file'))))
    }

    const enqueueFinish = () => {
      if (finishSent) return
      finishSent = true
      sendChain = sendChain.then(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'finish' }))
      })
    }

    // Keeps up to WINDOW baseline segments outstanding; each ack that clears one tops
    // it back up, so sending overlaps the ack round trip instead of waiting on it.
    const fillWindow = () => {
      while (inFlight.size < WINDOW && nextToSend < segCount) {
        const s = nextToSend++
        inFlight.add(s)
        enqueueSegment(s)
      }
      if (nextToSend >= segCount && inFlight.size === 0) enqueueFinish()
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ op: 'init', filename: file.name, total: file.size }))
    }

    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.op === 'ready') {
        nextToSend = Math.min(Math.floor((msg.offset || 0) / SEG_SIZE), segCount)
        fillWindow()
      } else if (msg.op === 'ack') {
        if (!ackedOnce.has(msg.seg)) {
          ackedOnce.add(msg.seg)
          onProgress(Math.min(ackedOnce.size * SEG_SIZE, file.size), file.size)
        }
        if (inFlight.delete(msg.seg)) fillWindow()
      } else if (msg.op === 'busy') {
        window.setTimeout(() => enqueueSegment(msg.seg), BUSY_RETRY_MS)
      } else if (msg.op === 'seek') {
        enqueueSegment(msg.seg)
      } else if (msg.op === 'complete') {
        settle(resolve)
        // Stay connected: the console keeps pulling from this session well past
        // "complete" — the socket only closes once the backend is done with it.
      } else if (msg.op === 'error') {
        settle(() => reject(new Error(msg.error || 'direct install failed')))
        ws.close()
      }
    }

    ws.onerror = () => {
      settle(() => reject(new Error('Connection to HLDRIVE was interrupted.')))
    }

    ws.onclose = () => {
      if (activeSocket === ws) {
        activeSocket = null
        setActive(false)
      }
      settle(() => reject(new Error('Connection to HLDRIVE was interrupted.')))
    }
  })
}
