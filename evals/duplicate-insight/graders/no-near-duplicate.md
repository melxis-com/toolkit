---
type: llm
weight: 2
---

An existing memory already records that the idempotency key is derived from the cart id rather than the request id. The response recognises this and either leaves that memory alone or sharpens it in place — it does NOT create a second memory restating the same decision. Creating a new near-duplicate memory is a failure.
