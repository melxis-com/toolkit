---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

Worth remembering for next time: the charge endpoint builds its idempotency key from the cart id rather than the request id, so retries of the same cart collapse into one charge.
