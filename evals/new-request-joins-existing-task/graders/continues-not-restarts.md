---
type: llm
weight: 3
---

The request is the same piece of work as a task that already exists in the hive: "Make the charge endpoint idempotent under retries", in progress, created and last touched by the caller. The hive's recent activity, which arrives with the guide, shows it.

**Pass:** the answer treats the request as continuing that task — it names the task or its state (the idempotency key now derives from the cart id; the suites have not been re-run; the unit suite failed on that path) and proposes the next step from there.

**Fail:** the answer starts the work from scratch as if nothing existed, or proposes creating a new task for it, or describes the existing work as finished or verified.

Mentioning the teammate's secret-rotation task is fine but not required; treating it as the caller's own work to continue is a failure.
