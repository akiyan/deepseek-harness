import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const origin = 'https://harness.example';
const home = `${origin}/`;
const session = `${home}?session=42#last`;

function worker(windows = [], displayError) {
  const listeners = new Map();
  const notifications = [];
  const opened = [];
  let closed = 0;
  runInNewContext(script, { URL, self: {
    location: { origin },
    addEventListener: (event, listener) => listeners.set(event, listener),
    registration: { showNotification: async (title, options) => {
      if (displayError) throw displayError;
      notifications.push({ title, options });
    } },
    clients: {
      matchAll: async (options) => {
        assert.equal(options.type, 'window');
        assert.equal(options.includeUncontrolled, true);
        return windows;
      },
      openWindow: async url => { opened.push(url); },
    },
  } });
  function dispatch(name, fields) {
    let lifetime;
    listeners.get(name)({ ...fields, waitUntil: promise => { lifetime = promise; } });
    assert.ok(lifetime);
    return lifetime;
  }
  return {
    push: (data) => dispatch('push', { data }),
    click: (data) => dispatch('notificationclick', { notification: { data, close: () => { closed++; } } }),
    notifications, opened, get closed() { return closed; },
  };
}

test('push preserves notification details and the session URL', async () => {
  const w = worker();
  await w.push({ json: () => ({ title: 'Reply ready', body: 'Check DSH', path: '/?session=42#last', tag: 's42' }) });
  const [notification] = w.notifications;
  assert.equal(notification.title, 'Reply ready');
  assert.equal(notification.options.body, 'Check DSH');
  assert.equal(notification.options.tag, 's42');
  assert.equal(notification.options.data.url, session);
});

test('test push reports the browser result to the open application', async () => {
  for (const [error, status] of [[undefined, 'shown'], [new Error('permission'), 'display-error']]) {
    const messages = [];
    const w = worker([{ postMessage: value => messages.push({ ...value }) }], error);
    const ordinary = w.push({ json: () => ({ body: 'Test' }) });
    if (error) await assert.rejects(ordinary, error);
    else await ordinary;
    await w.push({ json: () => ({ body: 'Test', testId: 'test-id' }) });
    assert.deepEqual(messages, [{ type: 'dsh-web-push-test', id: 'test-id', status }]);
  }
});

test('push falls back for malformed payloads and nonlocal targets', async () => {
  const w = worker();
  await w.push({ json() { throw new SyntaxError(); } });
  assert.equal(w.notifications[0].title, 'DeepSeek Harness');
  for (const path of ['https://outside.example/a', '//outside.example', '/\\outside.example', '/\t/outside.example', 'javascript:alert(1)']) {
    await w.push({ json: () => ({ path }) });
  }
  for (const notification of w.notifications) assert.equal(notification.options.data.url, home);
});

test('click focuses an exact existing window and revalidates stored notification data', async () => {
  let focused = 0;
  const w = worker([{ url: session, focus: async () => { focused++; } }]);
  await w.click({ url: session });
  assert.equal(w.closed, 1);
  assert.equal(focused, 1);
  assert.deepEqual(w.opened, []);
  await w.click({ url: `${origin}/\\outside.example` });
  await w.click({ url: 'https://outside.example/' });
  assert.deepEqual(w.opened, [home, home]);
});

test('click opens the target when no matching tab is focusable', async () => {
  const w = worker([{ url: session, focus: async () => { throw new Error('tab closed'); } }]);
  await w.click({ url: session });
  assert.deepEqual(w.opened, [session]);
});
