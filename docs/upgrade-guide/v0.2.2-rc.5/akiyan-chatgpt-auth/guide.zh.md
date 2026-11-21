---
kind: upgrade-guide
description: akiyan fork 将自定义 chatgpt 提供方替换为上游 OpenAI 认证。
---

# 在 akiyan fork 中使用上游 ChatGPT 认证

[English](guide.md) | 中文

## 变更

akiyan fork 不再附带自定义的 `chatgpt` 提供方、专用账号 RPC 或账号卡片。ChatGPT 订阅通过上游 `openai-codex`（`OpenAI (ChatGPT plan)`）访问；API key 访问仍使用 `openai`。上游在 `openai` 上提供的可选 ChatGPT 认证保持不变。

旧 `llm-pi-ai/chatgpt` 凭据既不转换也不删除：不假定其 OAuth 客户端及存储字段兼容。现有会话日志不重写。这影响从旧版 akiyan fork 升级的安装，不影响已经使用上游认证的安装。

## 迁移

1. 升级前停止应用，并将数据目录备份到私有位置。
2. 在 Settings → Models 中通过 `openai-codex` 登录。回调无法到达宿主时，使用上游提供的返回 URL 输入框。
3. 将会话、默认设置和子智能体预设中旧的 `chatgpt` 选择改为 `openai-codex` 及可用模型。不要改名或复制存储中的 OAuth 记录。
4. 如需 API 计费，保留 `openai` 并选择其 API key 方式，或显式配置 `apiKeyEnv: OPENAI_API_KEY`。显式引用优先于已保存的登录凭据。
5. 确认所选提供方，发送一条简短消息，并在重启后再次确认可访问。真实登录需要账号持有者操作；无密钥测试不能证明账号具有使用资格。

远程浏览器操作和恢复方式见 [fork 运维迁移说明](https://github.com/akiyan/deepseek-harness-ops/blob/main/docs/sign-in-with-chatgpt.md)。
