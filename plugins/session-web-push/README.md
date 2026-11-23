# Session push notifications

English | [中文](README.zh.md)

This optional bundle sends Web Push notifications for DeepSeek Harness sessions when they complete or need your attention. Each browser opts in separately. Notifications can contain session content and may appear on the lock screen.

From this directory in a persistent checkout of the akiyan fork, run `npm ci --ignore-scripts`. Add the directory by absolute path in **Plugins**. Open the installed bundle's settings over HTTPS to register this browser. Keep the checkout in place: a local installation links to this directory.

See the [HTTPS setup and migration guide](https://github.com/akiyan/deepseek-harness-ops/blob/main/docs/web-push-https.md). Run `npm test` here for bundle tests. After installing the bundle dependencies and building the Web artifacts, run `DSH_TEST_SESSION_WEB_PUSH=1 DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/session-web-push.e2e.ts` from the fork root to exercise the bundle in a test profile.
