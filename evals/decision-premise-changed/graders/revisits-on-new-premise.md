---
type: llm
weight: 3
---

The saved decision (2026-06-12) keys charges on the cart id and rejected client-supplied keys "because the mobile client did not send them consistently". The user now reports that since mobile v4.2 every client sends its own key — the premise of that rejection.

**Pass** needs all of these:
- The answer brings in the recorded decision and its reason, as recorded.
- It recognizes that the stated reason for rejecting client keys is the very thing that has changed, and treats the question as open: it weighs switching on its merits (for example what the cart-id key still protects against, older clients that predate v4.2, or a key that is not stable across retries) and gives a recommendation or a concrete way to decide.
- The user's claim about v4.2 is taken as the user's report, not as something the agent verified.

Any recommendation passes — switch, switch with conditions, or keep the cart-id key for now — as long as it engages the changed premise on its merits. Raising callers or risks the hive does not record, as considerations rather than as recorded facts, is fine.

**Fail** on any of these: the v4.2 behaviour is saved to Melxis as a verified fact (saving it as the user's report is fine); it declines to reconsider because the matter was already decided; it repeats the old decision as the answer without engaging the changed premise; it invents recorded reasons, dates or people the saved memories do not contain; it says nothing was recorded.
