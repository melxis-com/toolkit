---
type: llm
weight: 3
---

The user asked why the idempotency key uses the cart id. The saved decision reads, in full: "Decided 2026-06-12 after the June webhook retry storm. A client retry gets a new request id, so a request-id key let two retries of the same cart each create a charge. The cart id is stable across retries, so keying on it collapses them into one charge. Rejected: client-supplied keys, because the mobile client did not send them consistently." Other saved memories in the hive (the retry-storm root cause, the open idempotency task) may also be cited.

**Pass** needs: the answer gives the retry reason (request ids change on retry, the cart id does not) as what the team recorded, not as a fresh guess.

**Fail** on any of these: the answer offers only a generic explanation with no sign it came from the saved decision; it states as recorded a reason, date or person that none of the saved memories contain; or it says nothing was recorded.
