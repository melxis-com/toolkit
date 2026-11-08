---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Review this function for bugs and tell me what you'd fix:

```js
function chunk(items, size) {
  const out = [];
  for (let i = 0; i <= items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
```
