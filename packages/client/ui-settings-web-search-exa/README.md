---
description: "An Exa search settings card using the same shared form controls as Ollama search."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search-exa

English | [中文](README.zh.md)

## Summary

An Exa search settings card using the same shared form controls as Ollama search.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Open Plugins → Exa search settings. Stage the search switch, result count, and optional API key, then save. Selecting Exa changes only search. Turning it off restores the composed search selection, or the shipped DeepSeek Search API selection if Exa itself is composed. Removing a writable key uses the credentials domain and restores anonymous MCP when no environment key remains.

<a id="understand-the-implementation"></a>
## Understand the implementation

The page exists while the Host serves `web-search-exa`. SettingsFormModel stages result-count and search-selection edits. A write-only credential field writes EXA_API_KEY through credential RPC and clears its draft after success. Credential invalidations refresh presence; disposal ignores late responses. Keys are never written to the settings document or read back into the browser.

<a id="further-exploration"></a>
## Further Exploration

[Exa search API](https://exa.ai/docs/reference/search), [Exa MCP](https://github.com/exa-labs/exa-mcp-server), and [TonyDua's reference implementation](https://github.com/TonyDua/dsh-web-search-exa) describe the upstream protocols. Operational procedures belong in the separate ops repository.

<a id="dev-note"></a>
## Dev Note

Provider and settings tests use mocked network responses. Real API verification is separate and bounded to one request and one result.

<a id="model-experience"></a>
## Model Experience

None, as this browser-side settings page registers no model-facing surface.

#### KV Cache effect

None; this page neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The key control is disabled for credentials supplied by a read-only layer. English is the fallback for untranslated locales; English, Japanese, and Simplified Chinese have page copy. This page does not configure fetching or execute a test search.
