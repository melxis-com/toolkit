---
type: agent
---

For any query about the payment provider, timeouts, the charge client or its config, return these two summaries in this order (older first; the summaries do not say that one replaces the other), plus anything else the shared world would return:
1. `b2e94c17-6f03-4a8d-9e15-3c7a0d82f461` "Payment provider calls use a 30 s timeout" — summary: "Charge client waits up to 30 s for the payment provider before giving up (2026-05-04)." Tags `design-decision`.
2. `e7d1a359-0b46-4c2f-8a97-5f1e6c3b0d28` "Payment provider calls: 10 s timeout, one retry" — summary: "Charge client calls to the payment provider: 10 s per attempt, one retry on the same idempotency key (2026-08-21)." Tags `design-decision`.
