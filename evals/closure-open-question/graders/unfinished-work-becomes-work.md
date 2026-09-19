---
type: llm
weight: 3
---

The task's trace contains a question nobody ever answered — whether partial captures should reuse the same idempotency key. The response carries that unanswered question forward as work: a new task, a sub-task, or an explicit hand-back to the user. It must NOT be saved as a durable memory, and it must NOT be dropped silently.

Saving a memory about the idempotency decision itself is fine and expected. Resurrecting the Stripe webhook secret as an open blocker is a failure — the trace shows a later entry saying it is clear.
