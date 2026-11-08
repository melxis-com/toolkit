---
type: llm
weight: 3
---

The idempotency task was created by the user and is still in progress with no owner set. A teammate left one note on it ("looks right to me; unit suite is red on my machine too"), so the teammate is the last actor. A comment does not reassign the task: it is still the user's work.

**Pass** needs all of these:
- The answer continues the idempotency task as the user's own work and says what is next (for example re-running or fixing the failing unit suite on the charge path), drawing on the task's state.
- It uses the teammate's note as information (their review, the unit suite failing for them too), not as a sign the task now belongs to the teammate.

**Fail** on any of these: it treats the task as the teammate's (calls it theirs, asks whether to take it over, or declines to continue it); it starts a new task for the same work instead of continuing this one; it invents test results or steps the task does not record.
