---
description: "此包提供 Exa 网页搜索及其设置，支持无密钥的匿名 MCP 和使用 EXA_API_KEY 的 REST API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-exa

[English](README.md) | 中文

## 概述

此包提供 Exa 网页搜索及其设置，支持无密钥的匿名 MCP 和使用 EXA_API_KEY 的 REST API。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在插件页面选择 Exa 网页搜索，设置搜索开关、结果数和可选密钥后保存。仅改变搜索，保留网页获取设置。密钥通过凭据存储或启动环境解析；无密钥时使用限流的匿名 MCP，配置密钥后使用 REST API 配额。认证请求失败时不会改用匿名请求。

<a id="understand-the-implementation"></a>
## 实现说明

提供方按请求读取实时配置，拒绝重定向，限制响应字节数并支持取消。MCP 客户端 SDK 管理初始化、JSON/SSE 解码与连接关闭。设置表单暂存修改，密钥通过凭据 RPC 单独写入，保存成功后清空输入；销毁后忽略迟到的读取。

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

- 匿名 MCP 共享调用限额，失败不自动重试。本包不提供 Exa 网页获取或自动搜索验证；只读凭据不可编辑。设置页面支持英文、日文和简体中文，其他语言回退到英文。
