---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-21-prompt-suggestion-request

[English](2026-11-21-prompt-suggestion-request.md) | 中文

## 概述

新增仅写日志的审计记录，记录请求下一条消息建议所用的有界输入和调用设置，不保存候选内容，也不新增会话消息。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-21-prompt-suggestion-request
baseline: false
changes:
  - root: "event:session/prompt-suggestion-request"
    previous: null
    after: "6ee4248f6fd997e16a71ecd3df9421921ec0b895852613546983841b8c27d9ff"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

不认识此事件的 V4 读取器保留可忽略记录，且不更改后续轮次或会话历史。写入器仅对此事件自动设置 ignorable 标记。认识新事件的 V4 读取器也可读取没有此事件的日志。

<a id="verification"></a>
## 验证

V4 开放词汇测试覆盖两种读取器词汇，并验证去掉标记以后旧读取器会拒绝未知记录。当前事件准入测试覆盖可忽略记录在写入前后保持不变。

<a id="dev-note"></a>
## 开发备注

无。
