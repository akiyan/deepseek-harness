---
description: "共享 web 能力的 Exa 搜索提供方，无密钥时使用匿名 MCP，配置 EXA_API_KEY 后使用 REST。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-exa

[English](README.md) | 中文

## 概述

共享 web 能力的 Exa 搜索提供方，无密钥时使用匿名 MCP，配置 EXA_API_KEY 后使用 REST。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

基础组合包以 `exa` 加载此提供方。在网页搜索设置中选择它，或设置 `web.searchProvider: exa`；加载不会改变默认的搜索或网页获取选择。通过凭据存储或启动环境解析 `EXA_API_KEY`。无密钥时将查询发送到限流的公开 Exa MCP 端点；配置密钥后使用 REST API 配额。认证请求失败时不会匿名重试。

<a id="understand-the-implementation"></a>
## 实现说明

插件通过 `ctx.effect` 注册，在销毁时取消未完成请求。每次搜索读取一份配置快照。MCP 客户端 SDK 管理初始化、JSON/SSE 解码与连接关闭。两条路径都拒绝重定向、支持取消并限制响应字节数，返回经过校验的 HTTP(S) 来源 URL 和高亮摘要。REST 调用使用 `POST /search`；匿名调用使用启用高亮的 `web_search_advanced_exa`。

<a id="further-exploration"></a>
## 进一步阅读

[Exa 搜索 API](https://exa.ai/docs/reference/search)、[Exa MCP](https://github.com/exa-labs/exa-mcp-server)与 [TonyDua 的参考实现](https://github.com/TonyDua/dsh-web-search-exa)描述上游协议。运维步骤在独立的 ops 仓库维护。

<a id="dev-note"></a>
## 开发备注

提供方和设置测试使用模拟网络响应。真实 API 验证独立执行，限定为一次请求、一个结果。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-web` 间接提供来源 URL、标题、高亮摘要、发布日期及结构化错误；由工具消费者负责渲染。

#### KV 缓存影响

本包不直接改变请求前缀，相关影响由工具消费者负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 匿名 MCP 共享调用限额，并受可用性约束。HTTP 失败直接报告，不自动重试。本包不提供 Exa 网页获取、隐式提供方选择或密钥验证搜索。
