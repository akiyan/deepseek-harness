---
description: "Exa 搜索设置卡片，复用 Ollama 搜索所用的共享表单控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search-exa

[English](README.md) | 中文

## 概述

Exa 搜索设置卡片，复用 Ollama 搜索所用的共享表单控件。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

打开插件 → akiyan 内置插件设置 → Exa 搜索设置，暂存搜索开关、结果数和可选 API 密钥，然后保存。选择 Exa 仅改变搜索。关闭时恢复组合配置的搜索选择；如果组合配置本身选择 Exa，则显式选择 DeepSeek Search API。通过凭据域删除可写密钥后，如无环境密钥，恢复匿名 MCP。

<a id="understand-the-implementation"></a>
## 实现说明

页面在 Host 服务 `web-search-exa` 期间存在。SettingsFormModel 暂存结果数和搜索选择的修改。只写凭据字段通过凭据 RPC 写入 EXA_API_KEY，成功后清空草稿。凭据失效通知刷新密钥存在状态；销毁后忽略迟到响应。密钥不会写入设置文档，也不会读回浏览器。输入框以遮罩文本显示，禁用自动填充并向密码管理器声明忽略，不使用登录密码输入框。

<a id="further-exploration"></a>
## 进一步阅读

[Exa 搜索 API](https://exa.ai/docs/reference/search)、[Exa MCP](https://github.com/exa-labs/exa-mcp-server)与 [TonyDua 的参考实现](https://github.com/TonyDua/dsh-web-search-exa)描述上游协议。运维步骤在独立的 ops 仓库维护。

<a id="dev-note"></a>
## 开发备注

提供方和设置测试使用模拟网络响应。真实 API 验证独立执行，限定为一次请求、一个结果。

<a id="model-experience"></a>
## 模型体验

无，本包仅提供浏览器设置页面，不注册模型可见的功能。

#### KV 缓存影响

无，本页面不组装或发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只读层提供的密钥不可编辑。设置页面支持英文、日文和简体中文，其他语言回退到英文。本页面不配置网页获取，也不执行测试搜索。
