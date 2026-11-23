/** The notification bundle's two public slot registrations, without browser push APIs. */
window.__ModuleLoader__.load({
  id: '@akiyan/dsh-session-web-push',
  factory(require) {
    const { createElement } = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.akiyan', () => ctx.slots.register({
          name: 'plugins.akiyan', id: 'session-web-push', label: 'Session push notifications',
        }, ({ view }) => view === 'page'
          ? createElement('section', { 'aria-label': 'Browser notification settings' }, 'Browser settings from the fixture')
          : 'Notification summary from the fixture'))
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'akiyan-session-web-push', label: 'Notifications', order: 20,
        }, () => createElement('p', null, 'Session settings from the fixture')))
      },
    }
  },
})
