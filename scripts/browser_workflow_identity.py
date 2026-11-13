"""Identify the exact GitHub workflow attempt and nightly browser shard."""

import re


PROJECTS = ("chromium", "firefox", "webkit", "mobile-chrome", "mobile-safari")
SHARDS = range(1, 9)


def run_identity(env):
    sha = env.get("GITHUB_SHA", "")
    run_id = env.get("GITHUB_RUN_ID", "")
    attempt = env.get("GITHUB_RUN_ATTEMPT", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not all(
        re.fullmatch(r"[1-9][0-9]{0,19}", value) for value in (run_id, attempt)
    ):
        raise ValueError("Expected a GitHub commit, run ID and attempt")
    return {"commit": sha, "run_id": int(run_id), "run_attempt": int(attempt)}
