---
type: llm
weight: 3
---

The saved decision (2026-06-12) keys charges on the cart id and rejected client-supplied keys "because the mobile client did not send them consistently". The user gives a general reason (a provider recommends client keys) but nothing says the mobile client has changed.

**Pass** needs all of these:
- The answer brings in the recorded decision and its reason, as recorded.
- It weighs the user's reason against that record: the recorded obstacle (inconsistent keys from the mobile client) still stands as far as anyone knows, so switching now would bring that risk back; it says what would change the answer (for example confirming the mobile client now sends a stable key on every request) rather than refusing to discuss it.

**Fail** on any of these: it recommends switching without addressing the recorded reason; it dismisses the question only because it was already decided, with no reasoning on the merits; it invents recorded reasons, dates or people the saved memories do not contain; it says nothing was recorded.
