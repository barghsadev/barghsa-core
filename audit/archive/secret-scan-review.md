# Secret-scan gate review

Gitleaks 8.30.1 scanned 1,029 local Git commits at `4de7109`. All 24 initial findings used the generic API-key rule. Review found deterministic test values, a password-generation alphabet, a public WebSocket handshake nonce, and a requirement document's SHA-256 digest. The exact commit/file/rule/line findings and reasons are recorded in `secret-scan-triage.json`.

The `.gitleaksignore` file excludes only these historical fingerprints. It does not exempt a file, directory, rule, or future commit. Tests and production source remain scanned. No credential was sent to a provider to test whether it worked.

The CI job checks out full history, runs the default detector rules across all available Git refs, and uploads only a redacted report. A shallow checkout fails before scanning. The wrapper downloads the pinned upstream release, verifies the archive against a committed SHA-256 checksum and extracts only its binary. Supported hosts are Linux x64 and macOS ARM64; another platform fails rather than silently skipping the scan. [Gitleaks release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), [tool documentation](https://github.com/gitleaks/gitleaks#usage).

Before scanning the project, a disposable Git repository receives a generated, nonfunctional credential. The same scanner and historical ignore list must reject it with exit 1 and produce a redacted report. Local execution passed this self-test and then scanned project history with zero remaining findings. The disposable repository is removed afterward.

This verifies the local macOS runner. The CI job and Linux archive checksum are configured but have not been executed on GitHub. A secret scanner cannot prove that every committed value is harmless or detect all credential formats. SAST, license policy and changed-code coverage remain separate F19 work.

Four wrapper tests pass for checksum rejection before extraction, ignoring archive traversal paths, retaining scanner failure codes with redaction/all-history arguments, and rejecting shallow checkouts before downloading the tool.
