import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

function harness(subscription, protocol = 'https:') {
  const dictionaries = new Map();
  const props = {};
  let browserView;
  const hooks = [];
  const disposers = [];
  const effects = [];
  let index = 0;
  let locale = 'en';
  const namespace = 'akiyan-session-web-push';
  const ctx = {
    effect: effect => {
      // Presence tracking is covered by the separate browser lifecycle suite.
      if (!String(effect).includes('trackPresence')) effects.push(effect());
    },
    locale: {
      getLocale: () => ({ active: locale }),
      bind: (ns = namespace) => key => dictionaries.get(`${ns}:${locale}`)[key],
      register: (ns, locale, dictionary) => {
        const key = `${ns}:${locale}`;
        dictionaries.set(key, dictionary);
        return () => dictionaries.delete(key);
      },
    },
    slots: {
      inject: (name, effect) => { if (name === 'conversation.view' || name === 'plugins.akiyan') effects.push(effect()); },

      register: (options, view) => {
        if (options.name === 'plugins.akiyan') {
          browserView = view;
          return () => { browserView = undefined; };
        }
        Object.assign(props, { options, view });
        return () => delete props.view;
      },
    },
  };
  const React = {
    Fragment: Symbol('React.Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial) { return hooks[index++] ??= { current: initial }; },
    useId: () => `test-${index++}`,
    useEffect(effect) {
      const i = index++;
      if (!(i in hooks)) {
        hooks[i] = true;
        disposers.push(effect());
      }
    },
  };
  runInNewContext(source, {
    window: {
      isSecureContext: Boolean(subscription), PushManager: {}, Notification: {}, location: { protocol, origin: `${protocol}//dsh.example` },
      __ModuleLoader__: { load: ({ factory }) => factory(() => React).apply(ctx) },
    },
    navigator: { serviceWorker: { getRegistration: async () => ({
      scope: 'https://dsh.example/session-web-push/', pushManager: { getSubscription: async () => subscription },
    }) } },
    Notification: { permission: 'granted' }, URL, setTimeout, clearTimeout, AbortController, fetch: (...args) => globalThis.fetch(...args),
  });
  const unregister = () => { while (effects.length) effects.pop()?.(); };
  const occurrence = sessionId => props.view({ sessionId, t: ctx.locale.bind() });
  return {
    dictionaries, props, occurrence, unregister, setLocale: next => { locale = next; },
    render(sessionId) {
      index = 0;
      const element = occurrence(sessionId);
      return element.type(element.props);
    },
    renderBrowser() {
      index = 0;
      const element = browserView({ view: 'detail', t: ctx.locale.bind('session-web-push') });
      return element.type(element.props);
    },
    unmount() { while (disposers.length) disposers.pop()(); },
  };
}

function all(node, type) {
  if (Array.isArray(node)) return node.flatMap(child => all(child, type));
  if (!node?.children) return [];
  return [...(node.type === type ? [node] : []), ...node.children.flatMap(child => all(child, type))];
}

test('HTTP shows HTTPS guidance in both settings views without issuing requests or exposing controls', async t => {
  // Localhost HTTP is considered a secure context by browsers; the app still requires HTTPS.
  const h = harness({ toJSON: () => ({}) }, 'http:');
  t.after(() => { h.unmount(); h.unregister(); });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  h.setLocale('ja');
  const view = h.occurrence('session-first');
  const [notice] = all(view, 'div').at(-1).children;
  for (const page of [h.renderBrowser(), notice.type(notice.props)]) {
    assert.equal(page.props.role, 'status');
    assert.equal(all(page, 'strong')[0].children[0], 'HTTPS 接続が必要です');
    assert.match(all(page, 'p')[0].children[0], /HTTPS アドレス/);
    for (const type of ['form', 'button', 'select', 'input']) assert.equal(all(page, type).length, 0);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 0);
});

test('registers an additive localized Conversation tab and keys its form by occurrence Session ID', () => {
  const h = harness();
  assert.equal(h.props.options.id, 'akiyan-session-web-push');
  assert.equal(h.props.options.order, 20);
  assert.equal(h.props.options.label(), 'Notifications');
  h.setLocale('ja');
  assert.equal(h.props.options.label(), '通知');
  for (const id of ['session-first', 'session-second']) {
    assert.equal(h.occurrence(id).props.sessionId, id);
    assert.equal(h.occurrence(id).props.key, id);
  }
  h.unregister();
  assert.equal(h.props.view, undefined);
  assert.equal(h.dictionaries.size, 0);
});

test('reads the current session and saves all fields, with null distinct from zero and false', async t => {
  const h = harness();
  t.after(() => { h.unmount(); h.unregister(); });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/session-web-push/api');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    const body = JSON.parse(options.body);
    calls.push(body);
    return {
      ok: true, status: 200, json: async () => ({
        mode: body.mode ?? null, delayMinutes: body.delayMinutes ?? null,
        notifyCompletion: body.notifyCompletion ?? null, notifyActionRequired: body.notifyActionRequired ?? null,
      }),
    };
  });
  const sessionId = 'session-first';
  const read = { action: 'session-settings', sessionId };
  h.render(sessionId);
  assert.deepEqual(calls, [read]);
  await new Promise(resolve => setImmediate(resolve));
  const selected = () => all(h.render(sessionId), 'select');
  const submit = () => all(h.render(sessionId), 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(selected().map(select => select.props.value), ['', '', '', '']);
  selected()[0].props.onChange({ target: { value: 'always' } });
  selected()[1].props.onChange({ target: { value: '0' } });
  selected()[2].props.onChange({ target: { value: 'false' } });
  selected()[3].props.onChange({ target: { value: 'true' } });
  await submit();
  assert.deepEqual(selected().map(select => select.props.value), ['always', 0, 'false', 'true']);
  selected()[2].props.onChange({ target: { value: '' } });
  assert.equal(all(h.render(sessionId), 'button')[0].props.disabled, false);
  await submit();
  assert.deepEqual(selected().map(select => select.props.value), ['always', 0, '', 'true']);
  selected()[0].props.onChange({ target: { value: '' } });
  selected()[1].props.onChange({ target: { value: '' } });
  selected()[3].props.onChange({ target: { value: '' } });
  await submit();
  assert.deepEqual(selected().map(select => select.props.value), ['', '', '', '']);
  assert.deepEqual(calls, [
    read,
    { ...read, mode: 'always', delayMinutes: 0, notifyCompletion: false, notifyActionRequired: true },
    { ...read, mode: 'always', delayMinutes: 0, notifyCompletion: null, notifyActionRequired: true },
    { ...read, mode: null, delayMinutes: null, notifyCompletion: null, notifyActionRequired: null },
  ]);
});

for (const [delayMinutes, label] of [[1, '1分'], [0, 'すぐに送信']]) {
  test(`shows defaults for this browser without changing inheritance (${delayMinutes})`, async t => {
    const subscription = { endpoint: 'https://push.example/subscription' };
    const h = harness({ toJSON: () => subscription });
    t.after(() => { h.unmount(); h.unregister(); });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return { ok: true, json: async () => body.action === 'status'
        ? { enabled: true, mode: 'background', delayMinutes, notifyCompletion: false, notifyActionRequired: true }
        : { mode: null, delayMinutes: null, notifyCompletion: null, notifyActionRequired: null } };
    });
    h.setLocale('ja');
    h.render('session-one');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ action: 'session-settings', sessionId: 'session-one' }, { action: 'status', subscription }]);
    const selects = all(h.render('session-one'), 'select');
    assert.deepEqual(selects.map(select => select.props.value), ['', '', '', '']);
    assert.deepEqual(selects.map(select => all(select, 'option')[0].children[0]), [
      '各ブラウザの既定値を使う（このブラウザ：非アクティブ時のみ）',
      `各ブラウザの既定値を使う（このブラウザ：${label}）`,
      '各ブラウザの既定値を使う（このブラウザ：オフ）',
      '各ブラウザの既定値を使う（このブラウザ：オン）',
    ]);
  });
}


test('browser toggles save both values independently and preserve the pair on mode and list changes', async t => {
  const subscription = { endpoint: 'https://push.example/subscription' };
  const h = harness({ toJSON: () => subscription });
  t.after(() => { h.unmount(); h.unregister(); });
  const requests = [];
  let defaults = { enabled: true, mode: 'background', delayMinutes: 3, notifyCompletion: true, notifyActionRequired: true };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.action === 'devices') return { ok: true, json: async () => ({
      devices: [{ id: 'current-browser', current: true, ...defaults }],
    }) };
    if (body.action === 'categories') {
      defaults = { ...defaults, notifyCompletion: body.notifyCompletion, notifyActionRequired: body.notifyActionRequired };
    }
    if (body.action === 'mode') defaults = { ...defaults, mode: body.mode };
    return { ok: true, json: async () => defaults };
  });
  h.setLocale('ja');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const toggles = () => all(h.renderBrowser(), 'input');
  h.renderBrowser();
  await flush();
  const labels = all(h.renderBrowser(), 'label').filter(label => all(label, 'input').length);
  assert.deepEqual(labels.map(label => label.children[1]), ['完了したとき', '対応が必要なとき']);
  assert.deepEqual(toggles().map(input => input.props.checked), [true, true]);
  toggles()[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(toggles().map(input => input.props.disabled), [true, true]);
  await flush();
  assert.deepEqual(toggles().map(input => input.props.checked), [false, true]);
  toggles()[1].props.onChange({ target: { checked: false } });
  await flush();
  assert.deepEqual(toggles().map(input => input.props.checked), [false, false]);
  assert.deepEqual(requests.filter(request => request.action === 'categories'), [
    { action: 'categories', subscription, notifyCompletion: false, notifyActionRequired: true },
    { action: 'categories', subscription, notifyCompletion: false, notifyActionRequired: false },
  ]);
  all(h.renderBrowser(), 'select')[0].props.onChange({ target: { value: 'always' } });
  await flush();
  assert.deepEqual(toggles().map(input => input.props.checked), [false, false]);
  assert.equal(all(h.renderBrowser(), 'select')[0].props.value, 'always');
  assert.equal(all(h.renderBrowser(), 'select')[1].props.value, 3);
  defaults = { ...defaults, notifyCompletion: true };
  await all(h.renderBrowser(), 'button').find(button => button.children[0] === '一覧を更新').props.onClick();
  await flush();
  assert.deepEqual(toggles().map(input => input.props.checked), [true, false]);
});
