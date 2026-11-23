---
kind: upgrade-guide
description: The akiyan fork replaces its custom chatgpt provider with upstream OpenAI authentication.
---

# Use upstream ChatGPT authentication in the akiyan fork

English | [中文](guide.zh.md)

## Change

The akiyan fork no longer ships its custom `chatgpt` provider, dedicated account RPC, or account card. ChatGPT-plan access uses upstream `openai-codex` (`OpenAI (ChatGPT plan)`); API-key access stays on `openai`. Upstream's optional ChatGPT authentication on `openai` is unchanged.

Old `llm-pi-ai/chatgpt` credentials are neither converted nor deleted: their OAuth client and stored fields are not assumed compatible. Existing conversation logs are not rewritten. This affects installations upgrading from the older akiyan fork, not installations that already use upstream authentication.

## Migration

1. Stop the application and back up its data directory privately before upgrading.
2. In Settings → Models, sign in through `openai-codex`. Use the upstream return-URL input when the callback cannot reach the host.
3. Replace old `chatgpt` selections in sessions, defaults, and subagent presets with `openai-codex` and an available model. Do not rename or copy stored OAuth records.
4. For API billing, keep `openai` and select its API-key method, or explicitly configure `apiKeyEnv: OPENAI_API_KEY`. An explicit reference takes priority over saved login credentials.
5. Confirm the selected provider, send a short message, and confirm access again after restarting. Real sign-in requires the account holder; keyless tests do not establish account eligibility.

See the [fork operations migration instructions](https://github.com/akiyan/deepseek-harness-ops/blob/main/docs/sign-in-with-chatgpt.md) for remote-browser operation and recovery.
