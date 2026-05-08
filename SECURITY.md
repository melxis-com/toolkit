# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please
report it privately by email to security@melxis.com.

Helpful information to include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact

We review reports on a best-effort basis. Please allow reasonable time
for a response before any public disclosure.

## Scope

This repository contains plugin manifests, skill definitions, and MCP configuration files. Security concerns may include:

- Misconfigured MCP server URLs that could lead to credential leakage
- Skill instructions that could lead to unintended data exposure
- Plugin manifest issues that could affect tool permissions

## MCP Server Security

The Melxis MCP server (`mcp.melxis.com`) uses OAuth 2.1 for authentication. All communication is encrypted via TLS. For security concerns related to the MCP server itself, please contact security@melxis.com.

## Local Hook Behavior

Claude Code hooks in this toolkit are plain Node ESM scripts registered in `hooks/hooks.json`.

- Hook scripts do not call `mcp.melxis.com` or any third-party API directly.
- Hook scripts do not create Melxis-owned local state directories such as `~/.melxis/`.
- Hook scripts read the Claude Code harness-provided transcript path only to derive prompt-time reminders, then emit text back to the harness.
- Hook scripts use Node stdlib only; no native dependencies, shell utilities, `jq`, or Python runtime are required.

Data reaches Melxis when the agent or user calls MCP tools through the OAuth-authenticated MCP connection.
