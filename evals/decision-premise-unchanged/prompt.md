---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Client-supplied idempotency keys are what Stripe recommends. Should we switch the charge endpoint to use the Idempotency-Key header from the client instead of deriving the key from the cart id?
