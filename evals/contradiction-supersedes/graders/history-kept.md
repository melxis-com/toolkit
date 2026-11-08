---
type: llm
focus: mock_calls
weight: 3
---

The user reported a change that contradicts the saved decision `4a1f8c62-3d9e-4b57-a816-0e2c7f5b9d43` (key on cart id). Melxis keeps the history of a decision: the new decision is a new mel that supersedes the old one, and the old mel's content is not rewritten to say the opposite.

**Pass** needs: a new mel records the switch to the checkout session id and its reason (carts reused across sessions collapsed genuine purchases), and it is linked to the old decision as superseding it.

**Fail** on any of these: the old mel's content is patched or updated to state the new decision; the old mel is deleted; nothing is saved.
