---
type: llm
weight: 3
---

The answer gives the picture the hive's recent activity carries: the open tasks and who is on each. (A fourth, completed task — structured logging on the charge endpoint — may be mentioned as done; it is not required.)

**Pass** needs all of these:
- The webhook-secret rotation is in progress and is a teammate's work (not the caller's).
- The charge-endpoint idempotency work is in progress and is the caller's own.
- The refund-path audit is pending and nobody has started it (it was created by the caller, so calling it the caller's own pending item is fine).

**Fail** on any of these:
- Attributing the secret rotation to the caller, or the idempotency work to the teammate.
- Claiming the idempotency tests pass or that the work is done — nothing in the hive says so.
- Inventing a task, a deadline, or an owner the hive does not record.
