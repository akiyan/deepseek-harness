const activeLeaseMs = 15_000
const forgetAfterMs = 60_000
const maxTabsPerDevice = 64

export function modeOf(value) {
  return value === 'always' || value === 'manual' ? value : 'background'
}

function deviceKey({ origin, subscription }) {
  return JSON.stringify([origin, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth])
}

// Presence is intentionally process-local. Unknown or disconnected means no active GUI.
export function createPresence(now = () => performance.now()) {
  const devices = new Map()
  return {
    record(device, { tabId, active, seq, sessionId }) {
      const time = now()
      const key = deviceKey(device)
      for (const [id, tabs] of devices) {
        for (const [tab, mark] of tabs) if (time - mark.time >= forgetAfterMs) tabs.delete(tab)
        if (!tabs.size) devices.delete(id)
      }
      let tabs = devices.get(key)
      if (!tabs) devices.set(key, tabs = new Map())
      const previous = tabs.get(tabId)
      if (previous && previous.seq >= seq) return false
      if (!previous && tabs.size >= maxTabsPerDevice) {
        const inactive = [...tabs].find(([, mark]) => !mark.active || time - mark.time >= activeLeaseMs)
        if (!inactive) return false
        tabs.delete(inactive[0])
      }
      tabs.set(tabId, { seq, active, time, sessionId })
      return true
    },
    forget(device) { devices.delete(deviceKey(device)) },
    isActive(device) {
      const tabs = devices.get(deviceKey(device))
      const time = now()
      return Boolean(tabs && [...tabs.values()].some(mark => mark.active && time - mark.time < activeLeaseMs))
    },
    isSessionActive(sessionId) {
      const time = now()
      for (const tabs of devices.values()) {
        for (const mark of tabs.values()) {
          if (mark.active && mark.sessionId === sessionId && time - mark.time < activeLeaseMs) return true
        }
      }
      return false
    },
  }
}

export function shouldAutomaticallyNotify(device, presence) {
  if (device.paused === true) return false
  const mode = modeOf(device.mode)
  return mode === 'always' || (mode === 'background' && !presence.isActive(device))
}
