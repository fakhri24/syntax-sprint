#!/usr/bin/env bash
# Runs the Firestore rules tests against a throwaway emulator.
#
# The emulator needs a working JVM. Two macOS quirks make this fiddly:
#   - /usr/bin/java exists even with no JVM installed; it is a stub that fails
#     when run, so `command -v java` is not a usable check.
#   - Homebrew's openjdk is keg-only, so a perfectly good JVM can be installed
#     and still not be on PATH.
set -euo pipefail

has_working_java() {
  java -version >/dev/null 2>&1
}

if ! has_working_java; then
  for candidate in /opt/homebrew/opt/openjdk/bin /usr/local/opt/openjdk/bin; do
    if [ -x "$candidate/java" ]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

if ! has_working_java; then
  echo "The Firestore emulator needs a working JVM, and none was found." >&2
  echo "Install one with:  brew install openjdk" >&2
  exit 1
fi

# A project id distinct from the real one: these tests must never be able to
# reach production data, even by misconfiguration.
exec firebase emulators:exec \
  --project syntax-sprint-rules-test \
  --only firestore \
  "npx vitest run --config vitest.rules.config.mts"
