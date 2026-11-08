---
type: llm
focus: mock_calls
weight: 3
---

The user relayed an unverified customer report (a double charge on mobile Safari yesterday) and asked to keep it in mind. Value here is that the report is kept for later work without turning it into a confirmed fact.

**Pass** needs: the report is written to Melxis (a mel, a task note, or a verification task) and is marked as a user report that is not verified — for a mel, the tags `user-reported` and `needs-verification`; for a note or task, wording that it is reported and unverified.

**Fail** on any of these: nothing is written; it is written as a confirmed defect or root cause; it is linked to the June retry storm as its cause without evidence.
