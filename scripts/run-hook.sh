#!/bin/sh
# Resolves a working Node.js runtime and runs the given Melxis hook script.
#
# Why: hosts do not guarantee a usable PATH for hook commands. Codex runs
# hooks via `$SHELL -lc` (login, non-interactive — shell rc files are not
# read, and macOS path_helper resets PATH to the system minimum), so Node
# installed via Homebrew / nvm / fnm / volta is often unreachable as a bare
# `node`. Claude Code inherits its parent PATH and is usually fine.
#
# Strategy (same shape as Anthropic's official security-guidance plugin):
#   1. explicit override (MELXIS_NODE)
#   2. PATH lookup, excluding fnm's session-scoped multishell symlinks
#   3. stable version-manager shims and common install locations
#   4. nvm version scan (nvm has no stable shim), newest first
# Every candidate is probed before exec so broken shims are skipped.
# Resolution runs every time (no caching) so switching version managers
# never leaves a stale path behind.
#
# When no runtime is found the hook is skipped gracefully (exit 0) with a
# single actionable stderr line: a missing optional hook must not surface
# as a recurring host error.
#
# POSIX sh only — no bashisms; must run under /bin/sh and Git Bash alike.

script="$1"
if [ -z "$script" ]; then
  echo "melxis-hook: run-hook.sh requires a hook script path" >&2
  exit 0
fi
shift

probe() {
  # </dev/null: a broken shim must not be able to consume the hook's stdin
  # JSON while being probed — the real runtime still needs to read it.
  [ -n "$1" ] && [ -x "$1" ] && "$1" -e "" </dev/null >/dev/null 2>&1
}

# 1. Explicit override.
if probe "$MELXIS_NODE"; then
  exec "$MELXIS_NODE" "$script" "$@"
fi

# 2. PATH lookup. fnm multishell paths are per-session temporary symlinks —
#    they may already be dangling, so never rely on them.
found="$(command -v node 2>/dev/null || true)"
case "$found" in
  *fnm_multishells*) found="" ;;
esac
if probe "$found"; then
  exec "$found" "$script" "$@"
fi

# 3. Stable shims (work without shell init) and common install locations.
#    The trailing entries cover Windows under Git Bash (which Claude Code
#    requires on Windows, so `sh` is always available there): the official
#    installer location plus scoop / fnm / volta. APPDATA / LOCALAPPDATA are
#    only set on Windows; the :- fallback keeps the paths inert elsewhere.
for candidate in \
  "$HOME/.volta/bin/node" \
  "$HOME/.asdf/shims/node" \
  "$HOME/.local/share/mise/shims/node" \
  "$HOME/.nodenv/shims/node" \
  "$HOME/.local/share/fnm/aliases/default/bin/node" \
  "$HOME/Library/Application Support/fnm/aliases/default/bin/node" \
  "$HOME/.fnm/aliases/default/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node \
  /home/linuxbrew/.linuxbrew/bin/node \
  /snap/bin/node \
  "/c/Program Files/nodejs/node.exe" \
  "$HOME/scoop/shims/node.exe" \
  "${APPDATA:-/nonexistent}/fnm/aliases/default/node.exe" \
  "${LOCALAPPDATA:-/nonexistent}/Volta/bin/node.exe"
do
  if probe "$candidate"; then
    exec "$candidate" "$script" "$@"
  fi
done

# 4. nvm installs under versions/node/v<semver>/ with no stable shim.
#    Version-sort descending so v10 beats v9 (lexicographic order would not).
nvm_base="${NVM_DIR:-$HOME/.nvm}/versions/node"
if [ -d "$nvm_base" ]; then
  for version in $(ls "$nvm_base" 2>/dev/null | sort -rV); do
    if probe "$nvm_base/$version/bin/node"; then
      exec "$nvm_base/$version/bin/node" "$script" "$@"
    fi
  done
fi

echo "melxis-hook: Node.js not found — skipping this hook. Set MELXIS_NODE=/path/to/node (or add node to PATH) to enable Melxis hooks." >&2
exit 0
