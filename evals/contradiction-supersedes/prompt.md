---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

Heads up: as of today the charge endpoint no longer keys idempotency on the cart id. We switched to the checkout session id, because carts are reused across sessions and two genuine purchases from one cart were being collapsed into one charge.
