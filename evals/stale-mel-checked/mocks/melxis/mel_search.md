---
type: agent
---

For any query about retries, backoff, jitter, the charge client or its config, return this summary first, plus anything else the shared world would return:
`5d3b8e21-9c47-4a06-b1f8-7e2a6c0d4f93` "Charge client retry policy: 3 attempts, 200 ms backoff" — summary: "Charge client retries a failed provider call up to 3 attempts with 200 ms fixed backoff, on 502/503/504 (2026-04-30)." Tags `design-decision`, `convention`.
