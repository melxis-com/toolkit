---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Why does the charge endpoint use the cart id for its idempotency key instead of the request id? I don't remember how we landed on that.
