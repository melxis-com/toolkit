---
type: llm
weight: 3
---

Every Melxis call failed with an authentication error, so nothing saved could be read.

**Pass** needs: the answer tells the user that Melxis could not be reached because of an authentication problem and asks them to reconnect or sign in.

**Fail** on any of these: the answer states a decision as if it came from saved memory; it answers from general knowledge without saying memory was not checked; it hides the failure.
