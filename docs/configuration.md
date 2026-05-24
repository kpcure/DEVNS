# Configuration

DevNS configuration lives in:

```text
.devns/devns.config.json
```

## Minimal Config

```json
{
  "$schema": "../tools/schema/devns-config.schema.json",
  "version": 1,
  "features": ".devns/features.json",
  "candidates": ".devns/candidates.json",
  "rfcs": ".devns/rfcs",
  "history": ".devns/history",
  "policies": ".devns/policies",
  "skills": {
    "init": "devns-init",
    "rfc": "devns-rfc",
    "run": "devns-run"
  }
}
```

## Workspace Files

- `features`: executable feature queue. The run loop only claims items with approved RFCs.
- `candidates`: discovered work that still needs human confirmation or RFC clarification.
- `rfcs`: directory for RFC records and future per-feature RFC files.
- `history`: execution history, impact summaries, and evidence records.
- `policies`: project-local harness policies.
- `skills`: host-visible skill names or project-local skill overrides.

## Stop Hook

```json
{
  "hooks": {
    "stop": {
      "mode": "gate",
      "retryBudget": 3,
      "defaultDecision": "stop_for_human_review"
    }
  }
}
```

## Review Lanes

Review lanes are evidence-producing checks used by the Stop hook.

```json
{
  "reviewLanes": [
    {
      "id": "deterministic-checks",
      "type": "command",
      "command": "npm test",
      "required": true,
      "blocksCompletion": true
    }
  ]
}
```

Supported lane types planned for the core:

- `command`
- `agent`
- `builtin`

The config schema is fixed in:

```text
tools/schema/devns-config.schema.json
```

Project-specific behavior should be added through declared extension points such as `skills`, `agents`, `reviewLanes`, and `policies`, not by adding arbitrary top-level fields.
