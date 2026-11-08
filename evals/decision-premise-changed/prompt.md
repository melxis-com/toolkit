---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Since mobile app v4.2 (shipped last month) every client sends its own Idempotency-Key header on each charge request. Should we switch the charge endpoint to use the client-supplied key instead of deriving it from the cart id?
