/* Service worker for the dedicated /session-web-push/ scope. */
const appOrigin = self.location.origin;
const appHome = new URL('/', appOrigin).href;
// This dedicated worker does not intercept the application’s requests.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

function safeTarget(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /^\/[\\/]/.test(path)) return appHome;
  try {
    const target = new URL(path, appHome);
    if (target.origin === appOrigin && !target.username && !target.password) return target.href;
  } catch {
    // Fall back to the app home for malformed URLs.
  }
  return appHome;
}

self.addEventListener('push', event => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    // A malformed payload should still produce a user-visible notification.
  }
  const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title : 'DeepSeek Harness';
  event.waitUntil((async () => {
    let status = 'shown';
    try {
      await self.registration.showNotification(title, {
        body: typeof payload?.body === 'string' ? payload.body : '',
        ...(typeof payload?.tag === 'string' ? { tag: payload.tag } : {}),
        data: { url: safeTarget(payload?.path) },
      });
    } catch (error) {
      if (!payload?.testId) throw error;
      status = 'display-error';
    }
    if (typeof payload?.testId === 'string') {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'dsh-web-push-test', id: payload.testId, status });
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Validate again at click time; stored notification data outlives worker updates.
    const stored = event.notification.data?.url;
    let target = appHome;
    if (typeof stored === 'string' && stored.startsWith(appOrigin + '/')) {
      target = safeTarget(stored.slice(appOrigin.length));
    }
    // The app's tabs are outside this worker's small scope and are not controlled by it.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    if (existing) {
      try { await existing.focus(); return; } catch { /* The tab may have closed. */ }
    }
    await self.clients.openWindow(target);
  })());
});
