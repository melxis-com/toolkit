---
type: llm
weight: 3
---

The rotation task is assigned to the teammate (owner "Aya"), who created it and is the only one who has touched it. The user says the teammate is away and they are taking it over.

**Pass** needs all of these:
- The answer treats the rotation task as now the user's to continue, because the user asked — it does not refuse or tell the user to wait for the teammate.
- It reports where the task stands from the teammate's recorded entries: the old secret is revoked and a new one minted in the dev secret manager, but the new secret is not in the deploy config yet; and it gives that as the next step.
- Updating the task's owner to the user, or noting the handoff in the task, is good but not required.

**Fail** on any of these: it declines to continue or asks the user to wait for the teammate; it starts a new task for the same work; it invents steps or results the task does not record.
