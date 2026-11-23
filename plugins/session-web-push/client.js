window.__ModuleLoader__.load({
  id: '@akiyan/dsh-session-web-push',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const slot = 'plugins.akiyan';
    const id = 'session-web-push';
    const scope = '/session-web-push/';
    const api = `${scope}api`;
    const worker = `${scope}worker.js`;
    const modes = ['background', 'always', 'manual'];
    const delays = [0, 1, 3, 5, 30, 60];
    const heartbeatMs = 5000;
    const httpsEnglish = {
      httpsNeeded: 'HTTPS connection required',
      httpsHelp: 'Push notifications are unavailable over HTTP. Open DeepSeek Harness using its HTTPS address, then return to these settings.',
    };
    const httpsJapanese = {
      httpsNeeded: 'HTTPS 接続が必要です',
      httpsHelp: 'HTTP 接続ではプッシュ通知を利用できません。DeepSeek Harness の HTTPS アドレスで開き直すと、通知設定を変更できます。',
    };

    function isHttps() { return window.location?.protocol === 'https:'; }

    function HttpsNotice({ t }) {
      return h('div', { role: 'status', style: {
        display: 'grid', gap: 6, padding: 12, borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
      } }, h('strong', null, t('httpsNeeded')),
      h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('httpsHelp')));
    }
    const categoryKeys = ['notifyCompletion', 'notifyActionRequired'];
    const categoryEn = {
      categories: 'Automatic notification types',
      notifyCompletion: 'When completed',
      notifyActionRequired: 'When action is required',
      notifyActionRequiredHelp: 'Notifies you about questions or choices, approvals that block progress, and errors that stop the session. Ordinary progress does not trigger a notification.',
    };
    const categoryJa = {
      categories: '自動通知の種類',
      notifyCompletion: '完了したとき',
      notifyActionRequired: '対応が必要なとき',
      notifyActionRequiredHelp: '質問や選択肢、進行を止めている承認待ち、セッションが停止するエラーを通知します。通常の進捗は通知しません。',
    };
    const categoryGroup = {
      display: 'grid', gap: 8, margin: 0, minWidth: 0, padding: '8px 12px 12px',
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
    };
    const categoryLegend = { paddingInline: 4, fontWeight: 500 };

    const registerSessionNotificationTab = (() => {
      const slot = 'conversation.view';
      const id = 'akiyan-session-web-push';
      const modes = ['background', 'always', 'manual'];
      const delays = [0, 1, 3, 5, 30, 60];
      const en = {
        ...httpsEnglish,
        ...categoryEn,
        categoryOn: 'On', categoryOff: 'Off',
        tab: 'Notifications',
        title: 'Session notification settings',
        description: 'These settings override automatic push notifications for this session across registered browsers. Each setting left on the browser default is inherited separately. Browser registration and pause settings still apply.',
        mode: 'Notification mode',
        inherit: 'Use each browser’s default',
        defaultOpen: ' (this browser: ', defaultClose: ')',
        shortBackground: 'When inactive', shortAlways: 'Always', shortManual: 'Manual only',
        background: 'Only when DeepSeek Harness is not active',
        always: 'Always receive automatic notifications',
        manual: 'Only when sent by the session',
        delay: 'Automatic notification delay',
        delayHelp: 'Opening this session in the foreground on a registered browser cancels the pending notification. A one-turn delay override takes precedence; new settings apply to future notifications.',
        delegated: 'Automatic notifications are only available for top-level sessions.',
        manualDelayHelp: 'The delay has no effect while automatic notifications are off.',
        delay0: 'Immediately', delay1: '1 minute', delay3: '3 minutes', delay5: '5 minutes', delay30: '30 minutes', delay60: '60 minutes',
        loading: 'Loading notification settings…', save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.', retry: 'Try again',
        loadError: 'Could not load notification settings.', saveError: 'Could not save notification settings. Please try again.',
        forbidden: 'Only the DeepSeek Harness owner can manage these notification settings.',
      };
      const ja = {
        ...httpsJapanese,
        ...categoryJa,
        categoryOn: 'オン', categoryOff: 'オフ',
        tab: '通知',
        title: 'セッションの通知設定',
        description: 'このセッションの自動プッシュ通知に、登録済みのブラウザに共通の設定を指定できます。「各ブラウザの既定値を使う」を選んだ項目は、ブラウザごとの設定に従います。登録や一時停止の設定は引き続き有効です。',
        mode: '通知モード',
        inherit: '各ブラウザの既定値を使う',
        defaultOpen: '（このブラウザ：', defaultClose: '）',
        shortBackground: '非アクティブ時のみ', shortAlways: '毎回', shortManual: '任意送信のみ',
        background: 'DeepSeek Harness が非アクティブのときのみ',
        always: '常に自動通知を受け取る',
        manual: 'セッションからの任意送信のみ',
        delay: '自動通知の待ち時間',
        delayHelp: '待ち時間内に、登録済みブラウザでこのセッションを前面表示すると、保留中の通知は取り消されます。ターン限定の指定が優先され、設定の変更は新しい通知から適用されます。',
        delegated: '自動通知は親セッションでのみ利用できます。',
        manualDelayHelp: '自動通知がオフの間、待ち時間は適用されません。',
        delay0: 'すぐに送信', delay1: '1分', delay3: '3分', delay5: '5分', delay30: '30分', delay60: '60分',
        loading: '通知設定を読み込んでいます…', save: '設定を保存', saving: '保存中…', saved: '設定を保存しました。', retry: '再試行',
        loadError: '通知設定を読み込めませんでした。', saveError: '通知設定を保存できませんでした。もう一度お試しください。',
        forbidden: 'この通知設定を変更できるのは DeepSeek Harness の所有者のみです。',
      };

      async function requestSettings(sessionId, fields, controller) {
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch('/session-web-push/api', {
            method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
            cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'session-settings', sessionId, ...fields }),
          });
          if (response.status === 401 || response.status === 403) return { forbidden: true };
          if (!response.ok) throw new Error('Could not access session notification settings');
          const settings = await response.json();
          if (!settings || (settings.mode !== null && !modes.includes(settings.mode)) ||
              (settings.delayMinutes !== null && !delays.includes(settings.delayMinutes)) ||
              categoryKeys.some(key => settings[key] !== null && typeof settings[key] !== 'boolean')) {
            throw new Error('Invalid session notification settings');
          }
          return {
            mode: settings.mode, delayMinutes: settings.delayMinutes,
            notifyCompletion: settings.notifyCompletion, notifyActionRequired: settings.notifyActionRequired,
          };
        } finally {
          clearTimeout(timer);
        }
      }

      const container = { flex: '1 1 auto', minHeight: 0, minWidth: 0, overflow: 'auto', padding: '16px 20px' };
      const stack = { display: 'grid', gap: 16, maxWidth: 540, margin: '0 auto' };
      const field = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6, fontWeight: 500 };
      const text = { margin: 0, lineHeight: 1.5, overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' };
      const errorStyle = { ...text, color: 'var(--dsw-alias-state-error-primary)' };
      const control = {
        minWidth: 0, maxWidth: '100%', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
        font: 'inherit', padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6,
      };
      const buttonStyle = { ...control, justifySelf: 'start' };
      const settingsChanged = (draft, saved) => ['mode', 'delayMinutes', ...categoryKeys].some(key => draft[key] !== saved[key]);

      /** Register the view using the host's React instance and return a disposer. */
      function registerSessionNotificationTab(ctx, React) {
        const { createElement: h, useEffect, useState, useRef, useId } = React;
        const t = ctx.locale.bind(id);

        function SessionSettings({ sessionId, t }) {
          const [state, setState] = useState({ phase: 'loading' });
          const [reload, setReload] = useState(0);
          const [browserDefaults, setBrowserDefaults] = useState(null);
          useEffect(() => {
            let live = true;
            if (supported()) void lookup().then(reg => reg?.pushManager.getSubscription())
              .then(sub => sub && request('status', sub))
              .then(status => {
                if (live && status?.enabled) setBrowserDefaults(status);
              }).catch(() => { /* Keep the generic inheritance label if unavailable. */ });
            return () => { live = false; };
          }, [reload]);
          const inheritedLabel = value => t('inherit') + (value ? t('defaultOpen') + value + t('defaultClose') : '');
          const defaultModeKey = { background: 'shortBackground', always: 'shortAlways', manual: 'shortManual' }[browserDefaults?.mode];
          const defaultDelay = browserDefaults?.delayMinutes;
          const life = useRef(null);
          const titleId = useId();
          const delayHelpId = useId();
          const categoryHelpId = useId();
          useEffect(() => {
            const controller = new AbortController();
            const open = { saving: false };
            life.current = open;
            requestSettings(sessionId, undefined, controller).then(settings => {
              if (life.current !== open) return;
              setState(settings.forbidden ? { phase: 'forbidden' } : { phase: 'ready', saved: settings, draft: settings });
            }).catch(() => {
              if (life.current === open) setState({ phase: 'loadError' });
            });
            return () => {
              life.current = null;
              controller.abort();
            };
          }, [sessionId, reload]);

          async function save(event) {
            event.preventDefault();
            const open = life.current;
            if (!open || open.saving || state.phase !== 'ready') return;
            if (!settingsChanged(state.draft, state.saved)) return;
            open.saving = true;
            setState({ ...state, phase: 'saving', notice: undefined });
            try {
              // Finish an explicit save even if the user switches views; never publish its result to another occurrence.
              const settings = await requestSettings(sessionId, state.draft, new AbortController());
              if (life.current !== open) return;
              setState(settings.forbidden
                ? { phase: 'forbidden' }
                : { phase: 'ready', saved: settings, draft: settings, notice: 'saved' });
            } catch {
              if (life.current === open) setState({ ...state, phase: 'ready', notice: 'saveError' });
            } finally {
              open.saving = false;
            }
          }

          let content;
          if (state.draft) {
            const saving = state.phase === 'saving';
            const dirty = settingsChanged(state.draft, state.saved);
            const change = (field, value) => setState(current => ({
              ...current, draft: { ...current.draft, [field]: value }, notice: undefined,
            }));
            content = h('form', { style: { display: 'grid', gap: 16 }, onSubmit: save, 'aria-busy': saving },
              h('label', { style: field }, t('mode'),
                h('select', { style: control, value: state.draft.mode ?? '', disabled: saving,
                  onChange: event => change('mode', event.target.value || null) },
                h('option', { value: '' }, inheritedLabel(defaultModeKey && t(defaultModeKey))),
                ...modes.map(mode => h('option', { key: mode, value: mode }, t(mode))))),
              h('div', { style: { display: 'grid', gap: 6 } },
                h('label', { style: field }, t('delay'),
                  h('select', { style: control, value: state.draft.delayMinutes ?? '', disabled: saving, 'aria-describedby': delayHelpId,
                    onChange: event => change('delayMinutes', event.target.value === '' ? null : Number(event.target.value)) },
                  h('option', { value: '' }, inheritedLabel(delays.includes(defaultDelay) && t(`delay${defaultDelay}`))),
                  ...delays.map(delay => h('option', { key: delay, value: delay }, t(`delay${delay}`))))),
                h('p', { id: delayHelpId, style: text }, t(state.draft.mode === 'manual' ? 'manualDelayHelp' : 'delayHelp'))),
              h('fieldset', { style: categoryGroup },
                h('legend', { style: categoryLegend }, t('categories')),
                ...categoryKeys.map(key => {
                  const browserValue = browserDefaults?.[key];
                  return h('label', { key, style: field }, t(key),
                    h('select', { style: control, value: String(state.draft[key] ?? ''), disabled: saving,
                      'aria-describedby': key === 'notifyActionRequired' ? categoryHelpId : undefined,
                      onChange: event => change(key, event.target.value === '' ? null : event.target.value === 'true') },
                    h('option', { value: '' }, inheritedLabel(typeof browserValue === 'boolean' && t(browserValue ? 'categoryOn' : 'categoryOff'))),
                    h('option', { value: 'true' }, t('categoryOn')),
                    h('option', { value: 'false' }, t('categoryOff'))));
                }),
                h('p', { id: categoryHelpId, style: text }, t('notifyActionRequiredHelp'))),
              h('button', { type: 'submit', style: buttonStyle, disabled: !dirty || saving }, t(saving ? 'saving' : 'save')),
              state.notice && h('p', { role: state.notice === 'saveError' ? 'alert' : 'status',
                style: state.notice === 'saveError' ? errorStyle : text }, t(state.notice)));
          } else {
            const loading = state.phase === 'loading';
            content = h(React.Fragment, null,
              h('p', { role: loading ? 'status' : 'alert', style: loading ? text : errorStyle }, t(state.phase)),
              state.phase === 'loadError' && h('button', { type: 'button', style: buttonStyle, onClick: () => {
                setState({ phase: 'loading' });
                setReload(value => value + 1);
              } }, t('retry')));
          }

          return h('section', { style: container, 'aria-labelledby': titleId },
            h('div', { style: stack },
              h('h2', { id: titleId, style: { margin: 0, fontSize: '1.15em' } }, t('title')),
              h('p', { style: text }, t('description')),
              content));
        }

        ctx.effect(() => ctx.locale.register(id, 'en', en));
        ctx.effect(() => ctx.locale.register(id, 'ja', ja));
        ctx.slots.inject(slot, () => ctx.slots.register({
          name: slot, id, order: 20, locale: id, label: () => t('tab'),
        }, ({ sessionId, t, useSessions }) => {
          const delegated = useSessions?.(({ byId }) => ['subagent', 'workflow'].includes(byId[sessionId]?.origin));
          if (!isHttps()) return h('section', { style: container }, h('div', { style: stack }, h(HttpsNotice, { t })));
          if (delegated) return h('p', { style: container }, t('delegated'));
          return h(SessionSettings, { key: sessionId, sessionId, t });
        }));

      }
      return registerSessionNotificationTab;
    })();

    const en = {
      ...httpsEnglish,
      ...categoryEn,
      title: 'Session push notifications',
      description: 'Choose when this browser receives session notifications, even with DeepSeek Harness closed.',
      mode: 'Notification mode',
      delay: 'Automatic notification delay',
      delayHelp: 'If you open that session in a visible, focused DeepSeek Harness tab before the delay ends, the notification is cancelled. Test notifications and notifications sent by a session are sent immediately.',
      delay0: 'Immediately', delay1: '1 minute', delay3: '3 minutes', delay5: '5 minutes', delay30: '30 minutes', delay60: '60 minutes',
      background: 'When DeepSeek Harness is not active (default)',
      always: 'Always receive automatic notifications',
      manual: 'Only when sent by the session',
      backgroundHelp: 'Send automatic notifications only when no DeepSeek Harness tab in this browser is visible and focused.',
      alwaysHelp: 'Send automatic notifications even while you are using DeepSeek Harness.',
      manualHelp: 'Turn off automatic notifications. A session can still send a notification using its notification tool.',
      devices: 'Registered browsers', current: 'This browser', registered: 'Registered browser',
      paused: 'Paused', delivering: 'On', pause: 'Pause', resume: 'Resume', remove: 'Remove',
      removeConfirm: 'Remove the selected browser? It will need to register again to receive notifications.',
      confirmRemove: 'Remove browser', cancel: 'Cancel', refreshDevices: 'Refresh list',
      noDevices: 'No browsers are registered.', devicesError: 'Could not update the browser list. Check your connection and try again.',
      device: 'These are this browser’s defaults. The Notifications tab can override them for a session, and the agent can override the delay for one turn. Use Registered browsers to manage other browsers.',
      deviceId: 'Browser ID',
      previewNotice: 'The session name and a short excerpt or question may be visible on your lock screen.',
      unsupported: 'Web Push is not available in this browser or connection. On iPhone or iPad, open DeepSeek Harness from your Home Screen.',
      blocked: 'Notifications are blocked. Allow them in your browser’s settings for this site, then check again.',
      enabled: 'Notifications are on for this browser.', disabled: 'Notifications are off for this browser.',
      pending: 'Working…', enable: 'Enable notifications', disable: 'Disable notifications',
      test: 'Send test notification', retry: 'Check again',
      sent: 'The browser received the test and accepted the notification. If no banner appears, check your notification center and OS notification settings.',
      unconfirmed: 'The push service accepted the test, but the browser did not confirm receipt. Keep this page open and try again.',
      displayError: 'The browser received the test but could not show it. Check notification permissions and OS settings.',
      missing: 'This subscription is no longer active. Enable notifications again.',
      permission: 'Notification permission was not granted.',
      continue: 'Permission granted. Click Enable notifications again to finish registration.',
      unavailable: 'Could not check notification status. Check your connection and try again.',
      failed: 'Could not complete the notification action. Check your connection and try again.',
      cleanup: 'Notifications are off on the server, but the browser could not remove its subscription. You can clear the site’s notification permissions in browser settings.',
    };
    const ja = {
      ...httpsJapanese,
      ...categoryJa,
      title: 'セッションのプッシュ通知',
      description: 'このブラウザでセッションの通知を受け取る条件を選べます。DeepSeek Harness を閉じていても受け取れます。',
      mode: '通知モード',
      delay: '自動通知の待ち時間',
      delayHelp: '待ち時間内に、表示されフォーカスされている DeepSeek Harness のタブで対象のセッションを開くと、通知は取り消されます。テスト通知とセッションからの任意送信はすぐに送信されます。',
      delay0: 'すぐに送信', delay1: '1分', delay3: '3分', delay5: '5分', delay30: '30分', delay60: '60分',
      background: 'DeepSeek Harness が非アクティブのときのみ（既定）',
      always: '常に自動通知を受け取る',
      manual: 'セッションからの任意送信のみ',
      backgroundHelp: 'このブラウザで DeepSeek Harness のタブが表示され、フォーカスされている間は、自動通知を送りません。',
      alwaysHelp: 'DeepSeek Harness の使用中でも自動通知を送ります。',
      manualHelp: '自動通知は行いません。セッションが通知ツールで送信した通知は受け取れます。',
      devices: '登録済みブラウザ', current: 'このブラウザ', registered: '登録済みブラウザ',
      paused: '一時停止中', delivering: 'オン', pause: '一時停止', resume: '再開', remove: '削除',
      removeConfirm: 'このブラウザの通知登録を削除しますか？通知を受け取るには再登録が必要です。',
      confirmRemove: 'ブラウザを削除', cancel: 'キャンセル', refreshDevices: '一覧を更新',
      noDevices: '登録済みのブラウザはありません。', devicesError: 'ブラウザ一覧を更新できませんでした。接続を確認して、もう一度お試しください。',
      device: 'ここで設定するのは、このブラウザの既定値です。セッションの「通知」タブや、エージェントのターン限定の待ち時間指定が優先されます。ほかのブラウザは「登録済みブラウザ」で管理できます。',
      deviceId: 'ブラウザ ID',
      previewNotice: 'セッション名と、応答の抜粋や質問がロック画面に表示されることがあります。',
      unsupported: 'このブラウザまたは接続ではプッシュ通知を利用できません。iPhone や iPad では、ホーム画面から DeepSeek Harness を開いてください。',
      blocked: '通知がブロックされています。ブラウザでこのサイトの通知を許可してから、もう一度確認してください。',
      enabled: 'このブラウザの通知はオンです。', disabled: 'このブラウザの通知はオフです。',
      pending: '処理中…', enable: '通知を有効にする', disable: '通知を無効にする',
      test: 'テスト通知を送る', retry: '再確認',
      sent: 'ブラウザがテスト通知を受信し、表示処理を受け付けました。見当たらない場合は通知センターや OS の通知設定を確認してください。',
      unconfirmed: 'プッシュ配信サービスはテストを受け付けましたが、ブラウザの受信を確認できませんでした。この画面を開いたまま再試行してください。',
      displayError: 'ブラウザはテスト通知を受信しましたが、表示できませんでした。通知の許可と OS の通知設定を確認してください。',
      missing: 'この購読は無効になっています。通知をもう一度有効にしてください。',
      permission: '通知が許可されませんでした。',
      continue: '通知が許可されました。もう一度「通知を有効にする」を押して登録を完了してください。',
      unavailable: '通知の状態を確認できませんでした。接続を確認して、もう一度お試しください。',
      failed: '通知の操作を完了できませんでした。接続を確認して、もう一度お試しください。',
      cleanup: 'サーバー側の通知を無効にしましたが、ブラウザの購読を削除できませんでした。ブラウザの設定でこのサイトの通知許可を解除できます。',
    };

    function supported() {
      return isHttps() && window.isSecureContext && 'serviceWorker' in navigator &&
        'PushManager' in window && 'Notification' in window;
    }

    async function request(action, subscription, fields, keepalive = false) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(api, {
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
          cache: 'no-store', signal: controller.signal, keepalive,
          ...(action ? {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, subscription: subscription?.toJSON(), ...fields }),
          } : {}),
        });
        if (!res.ok) throw new Error('Push API request failed');
        const data = await res.json();
        const valid = action === 'devices' || action === 'device' ? Array.isArray(data?.devices)
          : action ? typeof data?.enabled === 'boolean' : typeof data?.publicKey === 'string';
        if (!valid || (action === 'delay' && data.enabled && !delays.includes(data.delayMinutes)) ||
            (action === 'categories' && data.enabled && categoryKeys.some(key => typeof data[key] !== 'boolean'))) {
          throw new Error('Invalid push API response');
        }
        return data;
      } finally {
        clearTimeout(timer);
      }
    }

    async function lookup() {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      // getRegistration matches parent scopes too. Never use the app's own worker.
      return reg?.scope === new URL(scope, window.location.origin).href ? reg : undefined;
    }

    function trackPresence() {
      if (!supported()) return { update() {}, selectSession() {}, dispose() {} };
      const tabId = crypto.randomUUID();
      const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(id) : null;
      let sub;
      let seq = 0;
      let revision = 0;
      let selectedSessionId = null;
      let lastPresence;
      let pageHidden = false;
      let disposed = false;

      function send(active, force = false) {
        const sessionId = active ? selectedSessionId : null;
        if (!sub || (!force && lastPresence?.active === active && lastPresence.sessionId === sessionId)) return;
        lastPresence = { active, sessionId };
        const sent = ++seq;
        void request('presence', sub, { tabId, active, sessionId, seq: sent }, !active).then(result => {
          if (!disposed && seq === sent && !result.enabled) {
            sub = undefined;
            lastPresence = undefined;
          }
        }).catch(() => {
          if (seq === sent) lastPresence = undefined;
          // Retry on the next event or heartbeat. The server expires stale presence.
        });
      }

      function isActive() {
        return !pageHidden && document.visibilityState === 'visible' && document.hasFocus();
      }

      function sync() { send(isActive()); }

      function setSubscription(next, force = false) {
        if (disposed) return;
        revision++;
        if (sub?.endpoint === next?.endpoint) {
          if (force && next) send(isActive(), true);
          return;
        }
        send(false);
        sub = next;
        lastPresence = undefined;
        sync();
      }

      async function refresh() {
        const startingRevision = ++revision;
        try {
          const reg = await lookup();
          const next = await reg?.pushManager.getSubscription();
          if (startingRevision === revision) setSubscription(next);
        } catch {
          // Retry when the GUI regains focus or the subscription changes.
        }
      }

      function changeVisibility() { sync(); }
      function focus() { sync(); void refresh(); }
      function blur() { send(false); }
      function hidePage() { pageHidden = true; send(false); }
      function showPage() { pageHidden = false; focus(); }
      function subscriptionChanged(event) {
        if (event.data === 'enabled') void refresh();
        if (event.data === 'disabled') setSubscription(null);
      }

      document.addEventListener('visibilitychange', changeVisibility);
      window.addEventListener('focus', focus);
      window.addEventListener('blur', blur);
      window.addEventListener('pagehide', hidePage);
      window.addEventListener('pageshow', showPage);
      channel?.addEventListener('message', subscriptionChanged);
      const timer = setInterval(() => {
        const active = isActive();
        send(active, active);
      }, heartbeatMs);
      void refresh();

      return {
        update(next) {
          if (disposed) return;
          setSubscription(next, true);
          channel?.postMessage(next ? 'enabled' : 'disabled');
        },
        selectSession(sessionId) {
          if (disposed || selectedSessionId === sessionId) return;
          selectedSessionId = sessionId;
          sync();
        },
        dispose() {
          disposed = true;
          send(false);
          clearInterval(timer);
          document.removeEventListener('visibilitychange', changeVisibility);
          window.removeEventListener('focus', focus);
          window.removeEventListener('blur', blur);
          window.removeEventListener('pagehide', hidePage);
          window.removeEventListener('pageshow', showPage);
          channel?.close();
        },
      };
    }

    function waitForActivation(reg) {
      const activated = () => reg.active?.state === 'activated' && !reg.installing && !reg.waiting;
      if (activated()) return Promise.resolve();
      // navigator.serviceWorker.ready follows the current page's scope, not ours.
      return new Promise((resolve, reject) => {
        const watched = new Set();
        const timer = setTimeout(() => finish(new Error('Push worker did not activate')), 12000);
        function finish(error) {
          clearTimeout(timer);
          reg.removeEventListener('updatefound', check);
          for (const candidate of watched) candidate.removeEventListener('statechange', check);
          if (error) reject(error); else resolve();
        }
        function check() {
          if (activated()) return finish();
          for (const candidate of [reg.installing, reg.waiting, reg.active]) {
            if (!candidate || watched.has(candidate)) continue;
            watched.add(candidate);
            candidate.addEventListener('statechange', check);
          }
          if (watched.size && [...watched].every(candidate => candidate.state === 'redundant')) {
            finish(new Error('Push worker installation failed'));
          }
        }
        reg.addEventListener('updatefound', check);
        check();
      });
    }

    function decodePublicKey(key) {
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Invalid VAPID public key');
      return bytes;
    }

    function browserLabel() {
      const ua = navigator.userAgent;
      const browser = /Edg(?:A|iOS)?\//.test(ua) ? 'Edge' : /(?:OPR|Opera)\//.test(ua) ? 'Opera'
        : /(?:Firefox|FxiOS)\//.test(ua) ? 'Firefox' : /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : null;
      const os = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS / iPadOS'
        : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS'
          : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : null;
      return [browser, os].filter(Boolean).join(' / ') || undefined;
    }

    async function subscribe(language, prepared, presence) {
      async function enable(sub) {
        const result = await request('subscribe', sub, { language, label: browserLabel() });
        if (!result.enabled) throw new Error('Subscription was not enabled');
        presence.update(sub);
        return result;
      }
      // Invoke permission from the click before any unrelated async work.
      const permission = Notification.permission === 'granted'
        ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') return { notice: 'permission' };
      if (prepared.current) {
        const { reg, applicationServerKey } = prepared.current;
        prepared.current = null;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        return enable(sub);
      }
      const { publicKey } = await request();
      const applicationServerKey = decodePublicKey(publicKey);
      const reg = await navigator.serviceWorker.register(worker, { scope });
      await waitForActivation(reg);
      let sub = await reg.pushManager.getSubscription();
      const currentKey = sub?.options.applicationServerKey;
      if (currentKey) {
        const bytes = new Uint8Array(currentKey);
        if (bytes.length !== applicationServerKey.length || bytes.some((byte, i) => byte !== applicationServerKey[i])) {
          await request('unsubscribe', sub);
          presence.update(null);
          if (!await sub.unsubscribe()) throw new Error('Could not replace old subscription');
          sub = null;
        }
      }
      if (!sub && navigator.userActivation?.isActive === false) {
        prepared.current = { reg, applicationServerKey };
        return { enabled: false, notice: 'continue' };
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      return enable(sub);
    }

    async function testNotification(reg, sub) {
      // The application's page is outside the worker scope, so explicitly check for an update.
      await reg.update();
      await waitForActivation(reg);
      const testId = crypto.randomUUID();
      const serviceWorker = navigator.serviceWorker;
      const scriptURL = new URL(worker, window.location.origin).href;
      let receive;
      const receipt = new Promise(resolve => { receive = resolve; });
      const onMessage = event => {
        if (event.source?.scriptURL !== scriptURL || event.data?.type !== 'dsh-web-push-test' || event.data.id !== testId) return;
        if (event.data.status === 'shown') receive('sent');
        if (event.data.status === 'display-error') receive('displayError');
      };
      serviceWorker.addEventListener('message', onMessage);
      let timer;
      try {
        const result = await request('test', sub, { testId });
        if (!result.enabled) return { ...result, notice: 'missing' };
        timer = setTimeout(() => receive('unconfirmed'), 12000);
        return { ...result, notice: await receipt };
      } finally {
        clearTimeout(timer);
        serviceWorker.removeEventListener('message', onMessage);
      }
    }

    async function perform(action, language, prepared, presence, fields) {
      if (action === 'subscribe') return subscribe(language, prepared, presence);
      const reg = await lookup();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return { enabled: false, notice: action === 'test' ? 'missing' : undefined };
      if (action === 'test') return testNotification(reg, sub);
      const result = await request(action, sub, fields);
      if (action === 'unsubscribe') {
        if (result.enabled) throw new Error('Subscription remains enabled');
        presence.update(null);
        try {
          if (!await sub.unsubscribe()) return { ...result, notice: 'cleanup' };
        } catch {
          return { ...result, notice: 'cleanup' };
        }
      }
      return result;
    }

    function selectedMainSession({ byId }) {
      let selected = null;
      for (const session of Object.values(byId)) {
        if (!(session.retainedBy.mainView > 0)) continue;
        // During a handoff both main references can briefly be retained. Do
        // not report either by list order; wait for the selection to settle.
        if (selected !== null) return null;
        selected = session.id;
      }
      return selected;
    }

    const activePanel = info => info.activePanelId;

    function PresenceSelection({ useSessions, usePanelInfo, selectSession }) {
      const sessionId = useSessions(selectedMainSession);
      const panelId = usePanelInfo(activePanel);
      React.useLayoutEffect(() => { selectSession(panelId === null ? sessionId : null); }, [selectSession, panelId, sessionId]);
      React.useLayoutEffect(() => () => selectSession(null), [selectSession]);
      return null;
    }

    const validMode = mode => modes.includes(mode) ? mode : 'background';
    const validDelay = delay => delays.includes(delay) ? delay : 0;
    const text = { margin: 0 };
    const hint = { ...text, color: 'var(--dsw-alias-label-secondary)' };
    const button = {
      font: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '6px 12px',
    };

    function Controls({ t, locale, presence }) {
      const [state, setState] = React.useState({ enabled: null, mode: 'background', delayMinutes: 0, notifyCompletion: true, notifyActionRequired: true, paused: false, busy: false, notice: null });
      const [list, setList] = React.useState({ devices: null, error: false });
      const [confirm, setConfirm] = React.useState(null);
      const modeHelp = React.useId();
      const delayHelp = React.useId();
      const categoryHelp = React.useId();
      const ready = supported();
      const inFlight = React.useRef(false);
      const mounted = React.useRef(false);
      const prepared = React.useRef(null);

      async function loadDevices(action, fields, adoptCurrent) {
        try {
          let sub;
          if (ready) {
            try {
              sub = await (await lookup())?.pushManager.getSubscription();
            } catch {
              // The list is still usable when local push storage is unavailable.
            }
          }
          const { devices } = await request(action, sub, fields);
          if (action === 'device' && fields.op === 'remove' && list.devices?.some(device => device.id === fields.deviceId && device.current)) {
            presence.update(null);
          }
          if (!mounted.current) return;
          setList({ devices, error: false });
          if (adoptCurrent && sub) {
            const current = devices.find(device => device.current);
            setState(prev => ({
              ...prev, enabled: !!current, mode: validMode(current?.mode),
              delayMinutes: validDelay(current?.delayMinutes), paused: !!current?.paused, notice: null,
              notifyCompletion: current ? current.notifyCompletion ?? prev.notifyCompletion : true,
              notifyActionRequired: current ? current.notifyActionRequired ?? prev.notifyActionRequired : true,
            }));
          }
          if (action === 'device') setConfirm(null);
        } catch {
          if (mounted.current) setList(prev => ({ ...prev, error: true }));
        }
      }

      async function run(action, fields) {
        if (inFlight.current) return;
        const listAction = action === 'devices' || action === 'device';
        if (!ready && !listAction) return;
        inFlight.current = true;
        setState(prev => ({ ...prev, busy: true, notice: listAction ? prev.notice : null }));
        try {
          if (listAction) {
            await loadDevices(action, fields, true);
          } else {
            try {
              const language = /^ja(?:-|$)/i.test(locale.getLocale().active) ? 'ja' : 'en';
              const result = await perform(action, language, prepared, presence, fields);
              if (mounted.current) setState(prev => ({
                ...prev, enabled: result.enabled ?? prev.enabled,
                mode: action === 'test' ? prev.mode : validMode(result.mode),
                delayMinutes: result.enabled === false ? 0 : validDelay(result.delayMinutes ?? prev.delayMinutes),
                notifyCompletion: result.notifyCompletion ?? (result.enabled === false ? true : prev.notifyCompletion),
                notifyActionRequired: result.notifyActionRequired ?? (result.enabled === false ? true : prev.notifyActionRequired),
                paused: result.paused ?? (result.enabled === false ? false : prev.paused), notice: result.notice,
              }));
            } catch {
              if (mounted.current) setState(prev => ({ ...prev, notice: action === 'status' ? 'unavailable' : 'failed' }));
            }
            if (action !== 'test') await loadDevices('devices', undefined, false);
          }
        } finally {
          inFlight.current = false;
          if (mounted.current) setState(prev => ({ ...prev, busy: false }));
        }
      }
      React.useEffect(() => {
        mounted.current = true;
        void run(ready ? 'status' : 'devices');
        return () => { mounted.current = false; };
      }, []);

      const blocked = ready && Notification.permission === 'denied';
      const controlButton = (label, disabled, onClick, target) => h('button', {
        type: 'button', disabled, style: { ...button, ...(disabled ? { opacity: 0.55 } : {}) }, onClick,
        'aria-label': target ? `${t(label)}: ${target}` : undefined,
      }, t(label));
      const actionButton = (action, label, disabled) => controlButton(label, disabled, () => { void run(action); });
      const stateLabel = !ready ? 'unsupported' : blocked ? 'blocked' : state.enabled === null ? null
        : state.enabled ? (state.paused ? 'paused' : 'enabled') : 'disabled';
      const error = ['failed', 'unavailable', 'permission', 'cleanup', 'displayError', 'unconfirmed'].includes(state.notice);
      return h('section', { style: { display: 'grid', gap: 12 }, 'aria-label': t('title') },
        h('p', { style: hint }, t('device')),
        h('p', { style: hint }, t('previewNotice')),
        h('div', { role: 'status', style: { display: 'grid', gap: 4 } },
          state.busy ? h('p', { style: text }, t('pending')) : stateLabel && h('p', { style: text }, t(stateLabel)),
          state.notice && h('p', { style: error ? { ...text, color: 'var(--dsw-alias-state-error-primary)' } : text }, t(state.notice))),
        ready && state.enabled && h('div', { style: { display: 'grid', gap: 4, justifyItems: 'start' } },
          h('label', { style: { display: 'grid', gap: 4 } }, t('mode'),
            h('select', { value: state.mode, disabled: state.busy, style: { ...button, maxWidth: '100%' },
              'aria-describedby': modeHelp, onChange: event => {
                const { value } = event.target;
                if (modes.includes(value)) void run('mode', { mode: value });
              },
            }, modes.map(mode => h('option', { key: mode, value: mode }, t(mode))))),
          h('p', { id: modeHelp, style: hint }, t(`${state.mode}Help`))),
        ready && state.enabled && h('div', { style: { display: 'grid', gap: 4, justifyItems: 'start' } },
          h('label', { style: { display: 'grid', gap: 4 } }, t('delay'),
            h('select', { value: state.delayMinutes, disabled: state.busy, style: { ...button, maxWidth: '100%' },
              'aria-describedby': delayHelp, onChange: event => {
                const delayMinutes = Number(event.target.value);
                if (delays.includes(delayMinutes)) void run('delay', { delayMinutes });
              },
            }, delays.map(delay => h('option', { key: delay, value: delay }, t(`delay${delay}`))))),
          h('p', { id: delayHelp, style: hint }, t('delayHelp'))),
        ready && state.enabled && h('fieldset', { style: categoryGroup },
          h('legend', { style: categoryLegend }, t('categories')),
          ...categoryKeys.map(key => h('label', { key, style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('input', { type: 'checkbox', checked: state[key], disabled: state.busy,
              'aria-describedby': key === 'notifyActionRequired' ? categoryHelp : undefined,
              onChange: event => { void run('categories', {
                notifyCompletion: state.notifyCompletion, notifyActionRequired: state.notifyActionRequired,
                [key]: event.target.checked,
              }); },
            }), t(key))),
          h('p', { id: categoryHelp, style: hint }, t('notifyActionRequiredHelp'))),
        ready && h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          state.enabled === true ? actionButton('unsubscribe', 'disable', state.busy)
            : state.enabled === false ? actionButton('subscribe', 'enable', state.busy || blocked) : null,
          state.enabled === true && actionButton('test', 'test', state.busy || blocked || state.paused),
          (blocked || state.notice === 'unavailable' || state.notice === 'failed') && actionButton('status', 'retry', state.busy)),
        h('section', { style: { display: 'grid', gap: 8 }, 'aria-label': t('devices'), 'aria-busy': state.busy },
          h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' } },
            h('h3', { style: text }, t('devices')),
            actionButton('devices', 'refreshDevices', state.busy)),
          list.error && h('p', { role: 'alert', style: { ...text, color: 'var(--dsw-alias-state-error-primary)' } }, t('devicesError')),
          list.devices?.length === 0 && h('p', { style: hint }, t('noDevices')),
          list.devices?.length > 0 && h('ul', { style: { margin: 0, paddingInlineStart: 20, display: 'grid', gap: 12 } },
            list.devices.map(device => {
              const name = device.label || t('registered');
              const shortId = `${t('deviceId')}: ${device.id.slice(0, 8)}`;
              const target = `${name} · ${shortId}`;
              const removing = confirm === device.id;
              return h('li', { key: device.id },
                h('div', { style: { display: 'grid', gap: 4, overflowWrap: 'anywhere' } },
                  h('strong', null, device.current ? `${name} · ${t('current')}` : name),
                  h('p', { style: hint }, [shortId, device.origin].filter(Boolean).join(' · ')),
                  h('p', { style: hint }, `${t(device.paused ? 'paused' : 'delivering')} · ${t(validMode(device.mode))}`),
                  h('p', { style: hint }, `${t('delay')}: ${t(`delay${validDelay(device.delayMinutes)}`)}`),
                  removing && h('p', { role: 'alert', style: text }, `${target} — ${t('removeConfirm')}`),
                  h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                    removing ? h(React.Fragment, null,
                      controlButton('confirmRemove', state.busy, () => {
                        void run('device', { deviceId: device.id, op: 'remove' });
                      }, target),
                      controlButton('cancel', state.busy, () => setConfirm(null), target),
                    ) : h(React.Fragment, null,
                      controlButton(device.paused ? 'resume' : 'pause', state.busy, () => {
                        void run('device', { deviceId: device.id, op: device.paused ? 'resume' : 'pause' });
                      }, target),
                      controlButton('remove', state.busy, () => setConfirm(device.id), target),
                    ))));
            }))),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale;
        ctx.effect(() => locale.register(id, 'en', en));
        ctx.effect(() => locale.register(id, 'ja', ja));
        let tracker;
        ctx.effect(() => {
          const current = trackPresence();
          tracker = current;
          return () => { current.dispose(); tracker = undefined; };
        });
        const presence = { update: sub => tracker?.update(sub) };
        const selectSession = sessionId => tracker?.selectSession(sessionId);
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${id}.presence` },
          props => h(PresenceSelection, { ...props, selectSession })));
        registerSessionNotificationTab(ctx, React);
        const translate = locale.bind(id);
        ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id, order: 24, label: () => translate('title'), locale: id },
          ({ view, t }) => view === 'summary' ? t(isHttps() ? 'description' : 'httpsNeeded')
             : isHttps() ? h(Controls, { t, locale, presence }) : h(HttpsNotice, { t })));
      },
    };
  },
});
