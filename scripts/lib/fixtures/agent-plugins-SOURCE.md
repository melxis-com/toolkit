# Agent Plugins schema fixtures

The two JSON fixtures preserve the assertions and descriptions of the Agent Plugins 1.0.0 schemas retrieved on September 30, 2026:

- [Plugin manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [MCP configuration schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)

Whitespace has been compacted in some objects. The upstream schema documents contain no license notice; none has been removed or replaced. See the upstream specification for its applicable terms. These fixtures are local build and test inputs and are excluded from the submission ZIP.

`validate-package-schema.mjs` implements the assertion keywords used by these exact schemas, including local references and transport alternatives. It rejects unsupported keywords, including in unused branches. It is a bounded validator for these snapshots, not a general JSON Schema implementation or evidence of dashboard acceptance.
