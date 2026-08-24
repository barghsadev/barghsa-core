#!/usr/bin/env bash
# Barghsa — Suppressed TypeScript Error Check
# Scans production source files for // @ts-expect-error and // @ts-ignore
# Fails if any are found, requiring PR review approval.
# Usage: ./scripts/check-suppressed-errors.sh [--allowlist]

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "${0%/*}/..")"

# Directories to scan (production source only)
SCAN_DIRS="apps packages"

# Exclude patterns: test files, generated code, node_modules, build output
EXCLUDE_PATTERNS=(
  "node_modules"
  "dist"
  ".next"
  ".turbo"
  "coverage"
  "*.test.ts"
  "*.test.tsx"
  "*.spec.ts"
  "*.spec.tsx"
  "*.test-d.ts"
  "**/__tests__/**"
  "**/test/**"
  "**/tests/**"
  "**/e2e/**"
  "**/playwright-report/**"
  "**/migrations/**"
  "**/drizzle/migrations/**"
)

# Build find command with exclusions
FIND_ARGS=()
for dir in $SCAN_DIRS; do
  FIND_ARGS+=("$dir")
done
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  FIND_ARGS+=(-not -path "*/${pattern}/*" -not -name "$pattern")
done

# Find suppressed error comments
# Match: // @ts-expect-error, // @ts-ignore, /* @ts-expect-error */, /* @ts-ignore */
FOUND=false
while IFS= read -r -d '' file; do
  line_matches=$(grep -n -E '@ts-expect-error|@ts-ignore' "$file" 2>/dev/null || true)
  if [ -n "$line_matches" ]; then
    if [ "$FOUND" = false ]; then
      echo "ERROR: Suppressed TypeScript errors found in production source:"
      echo ""
      FOUND=true
    fi
    echo "$file"
    echo "$line_matches" | while IFS= read -r line; do
      echo "  $line"
    done
    echo ""
  fi
done < <(find "${FIND_ARGS[@]}" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null)

if [ "$FOUND" = true ]; then
  echo "FAIL: Suppressed errors must be approved in PR review."
  echo "Remove the suppression or get explicit approval from a reviewer."
  exit 1
fi

echo "PASS: No suppressed TypeScript errors in production source."
exit 0