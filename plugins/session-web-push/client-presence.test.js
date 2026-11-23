import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const client = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function loadPage({ tabId = '23392e97-c2c1-4d39-9902-b6caa7815cb0', registered = true } = {}) {
  // Exercise the root effect and the overlay's selector/effects without a browser renderer.
  const components = new Map();
  const layoutEffects = [];
  let cursor = 0;
  let panelId = null;
  let byId = {};
  const controlStates = [];
  let controlCursor = 0;
  let mountControls;
  const React = {
    createElement(type, props, ...children) { return typeof type === 'function' ? type(props) : { type, props, children }; },
    useState(initial) {
      const i = controlCursor++;
      if (!(i in controlStates)) controlStates[i] = initial;
      return [controlStates[i], next => { controlStates[i] = typeof next === 'function' ? next(controlStates[i]) : next; }];
    },
    useId() { return `field-${controlCursor++}`; },
    useRef(current) {
      const i = controlCursor++;
      return controlStates[i] ??= { current };
    },
    useEffect(effect) { if (mountControls === undefined) mountControls = effect; },
    useLayoutEffect(effect, deps) {
      const i = cursor++;
      const previous = layoutEffects[i];
      if (previous && previous.deps.every((value, at) => Object.is(value, deps[at]))) return;
      previous?.cleanup?.();
      layoutEffects[i] = { deps, cleanup: effect() };
    },
  };
  function renderPresence() {
    cursor = 0;
    components.get('shell.overlay')({
      useSessions: select => select({ byId }),
      usePanelInfo: select => select({ activePanelId: panelId }),
    });
  }
  const window = Object.assign(new EventTarget(), {
    isSecureContext: true,
    PushManager: class {},
    Notification: class {},
    location: { protocol: 'https:', origin: 'https://dsh.example' },
    __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused });
  const posts = [];
  const intervals = new Map();
  const cleanup = [];
  const subscription = {
    endpoint: 'https://push.example/device',
    toJSON() { return { endpoint: this.endpoint }; },
  };
  let focused = true;
  let plugin;
  let workerRegistrations = 0;
  let delayMinutes = 3;
  runInNewContext(client, {
    window, document, Notification: window.Notification,
    crypto: { randomUUID: () => tabId }, URL, AbortController, setTimeout, clearTimeout,
    setInterval(callback, ms) { intervals.set(callback, ms); return callback; },
    clearInterval(callback) { intervals.delete(callback); },
    navigator: { serviceWorker: {
      async getRegistration() {
        return {
          scope: 'https://dsh.example/session-web-push/',
          pushManager: { async getSubscription() { return registered ? subscription : null; } },
        };
      },
      async register() { workerRegistrations++; throw new Error('Unexpected worker registration'); },
    } },
    async fetch(path, options) {
      const body = JSON.parse(options.body);
      posts.push({ path, ...body, keepalive: options.keepalive });
      if (body.action === 'delay') delayMinutes = body.delayMinutes;
      const result = { enabled: true, mode: 'background', paused: false, delayMinutes };
      return { ok: true, async json() {
        return body.action === 'devices' ? { devices: [{ ...result, id: 'browser-12345678', current: true }] } : result;
      } };
    },
  });
  plugin.apply({
    effect(effect) { cleanup.push(effect()); },
    locale: { register() { return () => {}; }, bind() {}, getLocale: () => ({ active: 'en' }) },
    slots: {
      inject(_slot, register) { cleanup.push(register()); },
      register({ name }, Component) {
        components.set(name, Component);
        return () => {
          if (name === 'shell.overlay') {
            for (const effect of layoutEffects) effect.cleanup?.();
          }
          components.delete(name);
        };
      },
    },
  });
  renderPresence();

  return {
    posts, intervals,
    setRegistered(next) { registered = next; },
    showSessions(retainedById) {
      byId = Object.fromEntries(Object.entries(retainedById).map(([id, retainedBy]) => [id, { id, retainedBy }]));
      renderPresence();
    },
    showPanel(next) { panelId = next; renderPresence(); },
    settings() {
      controlCursor = 0;
      const view = components.get('plugins.akiyan')({ view: 'page', t: key => key });
      if (typeof mountControls === 'function') {
        cleanup.push(mountControls());
        mountControls = null;
      }
      return view;
    },
    get workerRegistrations() { return workerRegistrations; },
    heartbeat() { for (const callback of intervals.keys()) callback(); },
    emit(type, focus = focused) { focused = focus; window.dispatchEvent(new Event(type)); },
    visibility(state) { document.visibilityState = state; document.dispatchEvent(new Event('visibilitychange')); },
    dispose() { for (const callback of cleanup.reverse()) callback(); },
  };
}

test('root effect reports a focused tab, heartbeats, blur, hidden state and BFCache transitions', async () => {
  const page = loadPage();
  await flush();
  assert.deepEqual([...page.intervals.values()], [5000]);
  page.heartbeat();
  page.emit('blur', false);
  page.heartbeat();
  page.emit('focus', true);
  page.visibility('hidden');
  page.heartbeat();
  page.visibility('visible');
  page.emit('pagehide');
  page.heartbeat();
  page.emit('pageshow');
  page.dispose();
  page.emit('focus');
  await flush();
  assert.equal(page.intervals.size, 0);
  assert.equal(page.workerRegistrations, 0);
  assert.deepEqual(page.posts.map(post => post.active), [true, true, false, true, false, true, false, true, false]);
  assert.deepEqual(page.posts.map(post => post.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const post of page.posts) {
    assert.equal(post.path, '/session-web-push/api');
    assert.equal(post.action, 'presence');
    assert.equal(post.tabId, '23392e97-c2c1-4d39-9902-b6caa7815cb0');
    assert.equal(post.keepalive, !post.active);
    assert.equal(post.sessionId, null);
    assert.equal(post.subscription.endpoint, 'https://push.example/device');
  }
});

test('foreground selection reports only the active main Session without waiting for a heartbeat', async () => {
  const page = loadPage();
  page.showSessions({ first: { mainView: 1 }, embedded: { sidebar: 1 } });
  await flush();
  page.showSessions({ first: { mainView: 1 }, embedded: { sidebar: 2 } });
  assert.deepEqual(page.posts.map(post => post.sessionId), ['first']);
  page.showSessions({ first: { mainView: 1 }, second: { mainView: 1 } });
  page.showSessions({ first: { recentView: 1 }, second: { mainView: 1 } });
  assert.deepEqual(page.posts.map(post => post.sessionId), ['first', null, 'second']);
  page.showPanel('plugins');
  page.showSessions({ third: { mainView: 1 } });
  assert.deepEqual(page.posts.map(post => post.sessionId), ['first', null, 'second', null]);
  assert.equal(page.posts.at(-1).active, true);
  page.showPanel(null);
  page.emit('blur', false);
  page.showSessions({ first: { mainView: 1 } });
  assert.deepEqual(page.posts.map(post => post.sessionId), ['first', null, 'second', null, 'third', null]);
  page.emit('focus', true);
  page.heartbeat();
  assert.deepEqual(page.posts.map(post => post.sessionId), ['first', null, 'second', null, 'third', null, 'first', 'first']);
  assert.deepEqual(page.posts.map(post => post.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  page.dispose();
  assert.deepEqual(page.posts.slice(-1).map(({ active, sessionId }) => [active, sessionId]), [[false, null]]);
});

test('settings display the saved delay and submit the numeric choice for this subscription', async () => {
  const page = loadPage();
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    return node?.children ? [node, ...node.children.flatMap(nodes)] : [];
  }
  const delaySelect = view => nodes(view).find(({ type, children }) => type === 'label' && children[0] === 'delay').children[1];
  page.settings();
  await flush();
  const select = delaySelect(page.settings());
  assert.equal(select.props.value, 3);
  assert.deepEqual(Array.from(select.children[0], option => option.props.value), [0, 1, 3, 5, 30, 60]);
  select.props.onChange({ target: { value: '30' } });
  await flush();
  assert.deepEqual(page.posts.find(post => post.action === 'delay'), {
    path: '/session-web-push/api', action: 'delay', subscription: { endpoint: 'https://push.example/device' },
    delayMinutes: 30, keepalive: false,
  });
  const view = page.settings();
  assert.equal(delaySelect(view).props.value, 30);
  assert.ok(nodes(view).some(({ type, children }) => type === 'p' && children[0] === 'delay: delay30'));
  page.dispose();
});

test('unregistered browsers do not register a worker or send presence; tabs use separate IDs', async () => {
  const first = loadPage({ registered: false });
  const second = loadPage({ tabId: '88921779-3f17-4a56-8daa-23c79cb2c28d' });
  await flush();
  first.heartbeat();
  assert.deepEqual(first.posts, []);
  assert.equal(first.workerRegistrations, 0);
  first.setRegistered(true);
  first.emit('focus', true);
  await flush();
  assert.equal(first.posts.length, 1);
  assert.equal(second.posts.length, 1);
  assert.notEqual(first.posts[0].tabId, second.posts[0].tabId);
  first.dispose();
  second.dispose();
});
