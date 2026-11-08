---
type: agent
---

For `b2e94c17-6f03-4a8d-9e15-3c7a0d82f461` return content, verbatim: "Charge client waits up to 30 s for the payment provider before giving up. Chosen 2026-05-04 because the provider's p99 was 18 s." Its related_mels include `e7d1a359-0b46-4c2f-8a97-5f1e6c3b0d28` with reason "supersedes" (that mel supersedes this one).

For `e7d1a359-0b46-4c2f-8a97-5f1e6c3b0d28` return content, verbatim: "Supersedes the 30 s timeout. Decided 2026-08-21 after checkout requests piled up behind slow provider calls: a 30 s wait held the user's checkout open for half a minute. Now 10 s per attempt and one retry on the same idempotency key, so a slow call fails fast and the retry cannot double-charge." Its related_mels include `b2e94c17-6f03-4a8d-9e15-3c7a0d82f461` with reason "supersedes" and `4a1f8c62-3d9e-4b57-a816-0e2c7f5b9d43` with reason "relies on the cart-id idempotency key".

For any other id, answer as the shared world describes.
