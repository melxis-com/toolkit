---
type: llm
weight: 3
---

This is a work request in the Acme Checkout hive, which the caller owns. Before planning, the agent read that hive's context — its guide and recent activity — and the plan shows it.

Two things to check.

**The plan builds on what the hive already holds.** The hive records that idempotency keys on the charge endpoint derive from the cart id, and that an in-progress task is making that endpoint idempotent under retries. A plan that places the retry budget next to that work, or at least acknowledges it, passes. A plan written as if the endpoint had no history — no mention of the idempotency work or the cart-id key — fails.

**No invented facts.** Claiming the test suites pass, or that the idempotency work is finished, is a failure: the hive says the suites have not been re-run and the unit suite failed on that path with nothing marking it clear.

Whether the agent created a task for this work does not matter here.
