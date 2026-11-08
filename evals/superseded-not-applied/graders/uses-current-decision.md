---
type: llm
weight: 3
---

Saved memory holds two decisions; only the full bodies (and the supersedes link) say which one is current: an older one (2026-05-04) setting a 30 s timeout, and a newer one (2026-08-21) that explicitly supersedes it with 10 s per attempt and one retry on the same idempotency key.

**Pass** needs: the answer recommends 10 s per attempt with one retry as the current recorded decision. Mentioning the 30 s value as the older, replaced setting is fine.

**Fail** on any of these: the answer recommends 30 s, presents both as equally current or leaves the user to choose between them; it invents a reason or date that neither decision contains; or it gives only a generic timeout recommendation with no sign it came from the saved decisions.
