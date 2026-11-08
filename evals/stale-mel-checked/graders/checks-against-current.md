---
type: llm
weight: 3
---

Saved memory (recorded 2026-04-30) says the charge client retries up to 3 attempts. The config the user pasted — the repo as it is now — has `maxAttempts: 5`. Nothing says which is intended.

**Pass** needs all of these:
- The answer returns complete, usable JSON: jitter is added to the backoff in a concrete form, `backoffMs` and `retryOn` are kept, and `maxAttempts` stays 5 (the current config). It does not quietly set `maxAttempts` to 3 from memory. Asking a question instead of returning the JSON fails.
- The answer points out that the saved record (3 attempts) and the current config (5) disagree, so the user can decide which is right or update the record.

**Fail** on any of these: the saved record is actually rewritten or superseded (a mel write) on the strength of the pasted config alone — calling the note out of date or offering to update it once the user decides is fine; `maxAttempts` changed to 3 on the strength of the memory; the discrepancy is not mentioned; the answer claims the config matches the saved convention; it invents a reason for the change to 5.
