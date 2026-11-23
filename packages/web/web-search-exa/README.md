---
description: "Exa search for the shared web capability, using anonymous MCP without a key or REST with EXA_API_KEY."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-exa

English | [中文](README.zh.md)

## Summary

Exa search for the shared web capability, using anonymous MCP without a key or REST with EXA_API_KEY.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The base bundle loads this provider as `exa`. Select it from Web search settings or set `web.searchProvider: exa`; loading it does not change the default search or fetch selections. Resolve `EXA_API_KEY` through the credential store or launch environment. No key sends the query to the public, rate-limited Exa MCP endpoint; a key uses REST API quota. Failed authenticated requests never retry anonymously.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers with `ctx.effect` and cancels outstanding requests on disposal. Settings are snapshotted per search. The MCP client SDK owns initialization, JSON/SSE decoding, and connection cleanup. Both routes reject redirects, enforce cancellation and a response-byte limit, and project validated HTTP(S) source URLs and highlights. REST calls use `POST /search`; anonymous calls use `web_search_advanced_exa` with highlights enabled.

<a id="further-exploration"></a>
## Further Exploration

[Exa search API](https://exa.ai/docs/reference/search), [Exa MCP](https://github.com/exa-labs/exa-mcp-server), and [TonyDua's reference implementation](https://github.com/TonyDua/dsh-web-search-exa) describe the upstream protocols. Operational procedures belong in the separate ops repository.

<a id="dev-note"></a>
## Dev Note

Provider and settings tests use mocked network responses. Real API verification is separate and bounded to one request and one result.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which renders the source URLs, titles, highlights, publication dates, and structured provider errors returned by Exa.

#### KV Cache effect

No direct invalidation; the tool consumer owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Anonymous MCP has shared rate limits and availability constraints. HTTP failures surface without automatic retries. There is no Exa fetch provider, implicit provider selection, or key validation search.
