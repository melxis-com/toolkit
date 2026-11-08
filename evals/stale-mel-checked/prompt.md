---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Here's the charge client's retry config as it is in the repo right now:

```json
{
  "maxAttempts": 5,
  "backoffMs": 200,
  "retryOn": [502, 503, 504]
}
```

Add jitter to the backoff, following how we've set this up before. Give me the updated JSON.
