---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-21-prompt-suggestion-request

English | [中文](2026-11-21-prompt-suggestion-request.zh.md)

## Summary

Adds a log-only audit record for the exact bounded input and controls sent to request a next-message suggestion. It stores neither the candidate nor an extra conversation message.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

V4 readers that do not recognize the new event retain it as an ignorable row and leave the next turn and the conversation surface unchanged. The writer supplies the ignorable marker automatically for this event only. V4 readers that recognize the new type also accept logs without it.

<a id="verification"></a>
## Verification

The V4 open-vocabulary test exercises both reader vocabularies and verifies that removing the marker makes the older reader refuse the unknown record. Current-event admission tests cover unchanged ignorable-row persistence.

<a id="dev-note"></a>
## Dev Note

None.
