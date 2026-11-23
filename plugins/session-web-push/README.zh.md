# 会话推送通知

[English](README.md) | 中文

这个可选插件包在 DeepSeek Harness 会话完成或需要你处理时发送 Web Push 通知。每个浏览器需单独启用。通知可能包含会话内容，并显示在锁屏上。

在 akiyan fork 的长期使用检出目录中，进入本目录并运行 `npm ci --ignore-scripts`。在 **插件** 页面中使用绝对路径添加本目录。通过 HTTPS 打开已安装插件包的设置，注册当前浏览器。请保留检出目录原址：本地安装会链接到本目录。

参见 [HTTPS 设置与迁移指南](https://github.com/akiyan/deepseek-harness-ops/blob/main/docs/web-push-https.md)。在本目录运行 `npm test` 可测试插件包。安装插件包依赖并构建 Web 产物后，在 fork 根目录运行 `DSH_TEST_SESSION_WEB_PUSH=1 DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/session-web-push.e2e.ts`，可在测试配置档中验证插件包。
