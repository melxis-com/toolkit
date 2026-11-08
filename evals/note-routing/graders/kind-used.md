---
type: regex
target: mock_calls
pattern: '"tool"\s*:\s*"mcp__plugin_melxis_melxis__task_note"\s*,\s*"input"\s*:\s*\{[^\n]*?"kind"\s*:\s*"blocker"'
match: not_contains
weight: 1
---
