#!/usr/bin/env python3
"""
Barghsa Build Loop — Deterministic Orchestrator
================================================
Zero LLM cost. State-machine driven, one tick per cron run.

Architecture:
  Builder  → Cursor CLI (agent -p) with Grok 4.6   [cursor-grok-4.6-high]
  Reviewer → Codex CLI (codex review) with GPT Sol 5.6
  Merge    → gh CLI

State machine matches AGENTS.md. Runs as no_agent=True cron job.
"""

import json, os, subprocess, sys, time
from pathlib import Path

BASE = Path("/Users/majid/barghsa-core")
STATE_FILE = BASE / "kanban/loop-state.json"
QUEUE_FILE = BASE / "kanban/task-queue.json"
EPICS_DIR = BASE / "kanban/epics"
LOCK_FILE = BASE / "kanban/.loop-runner.lock"

BUILDER_MODEL = "cursor-grok-4.6-high"
TASK_BRIEF = Path("/tmp/barghsa-task-brief.txt")
REVIEW_OUT = Path("/tmp/barghsa-review-out.txt")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def load_json(path):
    return json.loads(path.read_text())

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")

def shell(cmd, timeout=600, cwd=None):
    log(f"  $ {cmd[:160]}")
    p = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        timeout=timeout, cwd=cwd or str(BASE),
    )
    if p.returncode:
        log(f"    rc={p.returncode}: {p.stderr.strip()[-160:]}")
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def get_state():
    return load_json(STATE_FILE)

def put_state(s):
    save_json(STATE_FILE, s)

def push_history(s, status, task_key=""):
    if not task_key:
        task_key = s.get("current_task_key", "")
    h = s.setdefault("status_history", [])
    h.insert(0, {
        "status": status,
        "task_key": task_key,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    s["status_history"] = h[:100]
    s["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# ---------------------------------------------------------------------------
# Step 0: Validate backlog
# ---------------------------------------------------------------------------

def check_validator():
    rc, out, _ = shell("python3 kanban/scripts/build_backlog.py --check", timeout=30)
    if rc != 0:
        log(f"VALIDATOR FAILED: {out[:200]}")
        s = get_state()
        s["status"] = "blocked"
        s["last_error"] = f"Backlog validation failed: {out[:500]}"
        push_history(s, "blocked")
        put_state(s)
        return False
    log("Backlog OK")
    return True

# ---------------------------------------------------------------------------
# Step 1: Reconcile state with git/GitHub
# ---------------------------------------------------------------------------

def reconcile():
    s = get_state()
    _, br_out, _ = shell("git branch --show-current", timeout=5)

    if s["status"] in ("building",) and not br_out and s.get("current_branch"):
        shell(f"git fetch origin {shq(s['current_branch'])} --depth=1 2>/dev/null; "
              f"git checkout -B {shq(s['current_branch'])} origin/{shq(s['current_branch'])} 2>/dev/null || true",
              timeout=15)

    _, pr_raw, _ = shell("gh pr list --state open --json number,headRefName,url --jq '.[]'", timeout=10)
    open_prs = []
    if pr_raw:
        for line in pr_raw.split("\n"):
            line = line.strip()
            if line:
                open_prs.append(json.loads(line))

    for pr in open_prs:
        if pr["headRefName"].startswith("feat/e"):
            if s["status"] == "idle":
                log(f"Recovering orphan PR #{pr['number']} on {pr['headRefName']}")
                s["status"] = "in_review"
                s["current_branch"] = pr["headRefName"]
                s["current_pr_url"] = pr["url"]
                s["current_task_key"] = pr["headRefName"]
                push_history(s, "in_review")
                put_state(s)
            elif s.get("current_pr_url") != pr["url"]:
                s["current_pr_url"] = pr["url"]
                put_state(s)

    log("Reconciled")

# ---------------------------------------------------------------------------
# Branch name helpers
# ---------------------------------------------------------------------------

def safe_branch_slug(text, maxlen=40):
    """Strip shell-unsafe characters from a branch slug."""
    slug = text.lower().replace(" ", "-")
    slug = "".join(c for c in slug if c.isalnum() or c in "-_")
    return slug.strip("-")[:maxlen]

# ---------------------------------------------------------------------------
# Step 2: idle → pick next task, create branch, launch Cursor
# ---------------------------------------------------------------------------

def pick_next_task():
    queue = load_json(QUEUE_FILE)
    done = set(get_state().get("build_completed_tasks", []))
    for entry in queue:
        k = entry.get("key", "")
        if k and k not in done:
            return entry, k
    return None, None

def do_idle():
    s = get_state()
    entry, k = pick_next_task()
    if not entry:
        log("QUEUE COMPLETE")
        s["status"] = "complete"
        push_history(s, "complete")
        put_state(s)
        return

    fname = entry["fname"]
    task_id = entry["id"]
    title = entry.get("title", "")

    epic_no = fname.split("-")[0]
    tid_slug = task_id.lower().replace(".", "-")
    title_slug = safe_branch_slug(title[:50])
    branch = f"feat/e{epic_no}-{tid_slug}--{title_slug}"

    log(f"Selected: {k}  →  {branch}")

    # Gently delete stale remote/local branch if it exists
    shell(f"git push origin --delete {shq(branch)} 2>/dev/null || true", timeout=10)
    shell(f"git branch -D {shq(branch)} 2>/dev/null || true", timeout=5)

    # Create fresh branch
    shell("git fetch origin main --depth=1", timeout=15)
    shell(f"git checkout -b {shq(branch)} origin/main", timeout=10)

    # Read task context
    epic_path = EPICS_DIR / fname
    if epic_path.exists():
        text = epic_path.read_text()
        marker = f"**{task_id} \u2014"
        idx = text.find(marker)
        if idx < 0:
            marker = f"**{task_id} -"
            idx = text.find(marker)
        if idx >= 0:
            lines = text[idx:].split("\n")
            cut = 0
            for i, ln in enumerate(lines):
                if ln.startswith("## ") and i > 5:
                    cut = i
                    break
            task_section = "\n".join(lines[:cut or 60])
        else:
            task_section = f"Task {task_id} \u2014 {title} (from {fname})"
    else:
        task_section = f"Task {task_id} \u2014 {title}"

    brief = (
        f"Task: {k}\nFile: {fname}\nBranch: {branch}\n\n"
        f"{task_section}\n\n"
        "===\n"
        f"Implement this in the {title_slug} branch of barghsa-core.\n"
        "- Explore the codebase first to understand existing patterns.\n"
        "- Use conventional commits (feat/fix/chore).\n"
        "- Follow existing code patterns.\n"
        "- Add tests where applicable.\n"
        "- Run available checks before final commit.\n"
        "- Do not modify kanban files, queue, epic docs, or unrelated scopes.\n"
    )
    TASK_BRIEF.write_text(brief)

    # Update state
    s["status"] = "building"
    s["current_task_id"] = task_id
    s["current_task_file"] = fname
    s["current_branch"] = branch
    s["current_task_key"] = k
    s["current_pr_url"] = ""
    s["fix_attempts"] = 0
    s["last_error"] = ""
    push_history(s, "building")
    put_state(s)

    # Launch Cursor
    log(f"Launching Cursor (Grok 4.6) on {k}...")
    rc, out, err = shell(
        f"agent -p {shq(brief)} "
        f"--model '{BUILDER_MODEL}' "
        f"--trust --print",
        timeout=900
    )
    log(f"Cursor done (rc={rc})")

    if rc != 0:
        s = get_state()
        s["last_error"] = f"Cursor exit rc={rc}: {err[:200]}"
        put_state(s)
        return

    # Commit if any changes were made
    _, _, _ = shell("git add -A", timeout=15)
    rc2, staged, _ = shell("git diff --cached --name-only", timeout=10)
    if rc2 == 0 and staged.strip():
        shell(f"git commit -m 'feat: implement {shq(k)}'", timeout=15)
        shell(f"git push origin {shq(branch)} --no-verify", timeout=30)
        log("Committed and pushed")
        do_open_pr()
    else:
        log("No changes — Cursor made no changes. Retrying next tick.")
        s = get_state()
        s["last_error"] = "Cursor made no changes"
        put_state(s)
        # Stay in building state; next tick will retry
        return

# ---------------------------------------------------------------------------
# Step 3: building → retry Cursor or advance
# ---------------------------------------------------------------------------

def do_building():
    s = get_state()
    branch = s.get("current_branch", "")
    if not branch:
        log("No branch — resetting to idle")
        s["status"] = "idle"
        push_history(s, "idle")
        put_state(s)
        return

    # Check if there are already commits
    rc, ahead, _ = shell(f"git rev-list --count origin/main..{shq(branch)} 2>/dev/null", timeout=5)
    if rc == 0 and ahead.strip() and int(ahead.strip()) > 0:
        log(f"Branch {branch} is {ahead} ahead — moving to review")
        do_open_pr()
    else:
        log(f"No commits yet — re-running Cursor on {branch}")
        if TASK_BRIEF.exists():
            rc, _, _ = shell(
                f"agent -p {shq(TASK_BRIEF.read_text()[:3000])} "
                f"--model '{BUILDER_MODEL}' --trust --print",
                timeout=900
            )
            _, _, _ = shell("git add -A", timeout=15)
            rc2, staged, _ = shell("git diff --cached --name-only", timeout=10)
            if rc2 == 0 and staged.strip():
                shell(f"git commit -m 'feat: implement continued'", timeout=15)
                shell(f"git push origin {shq(branch)} --no-verify", timeout=30)
                do_open_pr()

# ---------------------------------------------------------------------------
# Open PR
# ---------------------------------------------------------------------------

def do_open_pr():
    s = get_state()
    branch = s.get("current_branch", "")
    k = s.get("current_task_key", "unknown")
    if not branch:
        return

    log(f"Opening PR for {k}")

    # Ensure pushed
    shell(f"git push origin {shq(branch)} --no-verify 2>/dev/null || true", timeout=30)

    # Run checks
    for check in ["typecheck", "lint", "test", "build"]:
        shell(f"pnpm --filter @barghsa/api {check} 2>&1 | tail -3 || true", timeout=120)

    # Draft PR
    rc, pr_url, _ = shell(
        f"gh pr create --draft "
        f"--title 'feat: {shq(k)}' "
        f"--body 'Implements {shq(k)}.\\n\\n## Validation\\nSee individual commits.' "
        f"--head {shq(branch)}",
        timeout=30
    )
    if rc != 0:
        _, pr_url, _ = shell(
            f"gh pr list --state open --head {shq(branch)} --json url --jq '.[0].url'",
            timeout=10
        )

    s = get_state()
    s["status"] = "in_review"
    s["current_pr_url"] = pr_url
    s["last_error"] = ""
    push_history(s, "in_review")
    put_state(s)
    log(f"PR: {pr_url}")

# ---------------------------------------------------------------------------
# Step 4: in_review → Codex review
# ---------------------------------------------------------------------------

def do_in_review():
    s = get_state()
    pr_url = s.get("current_pr_url", "")
    branch = s.get("current_branch", "")

    if not pr_url and branch:
        _, pr_url, _ = shell(
            f"gh pr list --state open --head {shq(branch)} --json url --jq '.[0].url'",
            timeout=10
        )
        if pr_url:
            s["current_pr_url"] = pr_url
            put_state(s)

    if pr_url:
        rc, info, _ = shell(
            f"gh pr view {pr_url} --json isDraft,mergeable --jq '.{{draft: .isDraft, mergeable: .mergeable}}'",
            timeout=10,
        )
        if rc == 0 and info:
            try:
                info_d = json.loads(info)
                if info_d.get("draft"):
                    shell(f"gh pr ready {pr_url}", timeout=10)
                    log("Marked PR ready")
                if info_d.get("mergeable") == "CONFLICTING":
                    log("Merge conflicts")
                    s["last_error"] = "Merge conflicts in PR"
                    put_state(s)
                    return
            except json.JSONDecodeError:
                pass

    # Codex review
    log("Running Codex review...")
    task_key = s.get("current_task_key", "")
    rc, out, err = shell(
        f"codex review --uncommitted "
        f"-c model='gpt-5.6-sol' "
        f"--title 'Review: {task_key}'",
        timeout=600
    )
    REVIEW_OUT.write_text(out + "\n\n=== STDERR ===\n" + err)

    lower = (out + " " + err).lower()
    if rc == 0 and any(w in lower for w in ["approve", "looks good", "no critical", "lgtm", "approved"]):
        log("Codex: APPROVED")
        do_merge()
    elif rc == 0 and any(w in lower for w in ["request_changes", "changes requested", "critical", "needs work"]):
        log("Codex: CHANGES REQUESTED")
        s = get_state()
        s["status"] = "fixing"
        s["fix_attempts"] = s.get("fix_attempts", 0) + 1
        push_history(s, "fixing")
        put_state(s)
    else:
        log(f"Codex ambiguous (rc={rc}). Output saved.")
        s = get_state()
        s["last_error"] = f"Review unclear (rc={rc})"
        put_state(s)

# ---------------------------------------------------------------------------
# Step 5: fixing
# ---------------------------------------------------------------------------

def do_fixing():
    s = get_state()
    if s.get("fix_attempts", 0) >= 3:
        log("3 attempts exhausted → blocked")
        s["status"] = "blocked"
        push_history(s, "blocked")
        put_state(s)
        return

    review_text = REVIEW_OUT.read_text()[:3000] if REVIEW_OUT.exists() else "Fix review findings"
    prompt = f"Fix issues from code review:\n\n{review_text}"

    log("Cursor fixing...")
    rc, _, err = shell(
        f"agent -p {shq(prompt)} "
        f"--model '{BUILDER_MODEL}' --trust --print",
        timeout=600
    )
    if rc != 0:
        s = get_state()
        s["last_error"] = f"Fix failed (rc={rc}): {err[:200]}"
        put_state(s)
        return

    _, _, _ = shell("git add -A && git diff --cached --quiet || "
                   "git commit -m 'fix: address review findings'", timeout=15)
    shell(f"git push origin {shq(s.get('current_branch', ''))} --no-verify", timeout=30)

    s = get_state()
    s["status"] = "in_review"
    s["last_error"] = ""
    push_history(s, "in_review")
    put_state(s)
    log("Back to in_review")

# ---------------------------------------------------------------------------
# Step 6: merge
# ---------------------------------------------------------------------------

def do_merge():
    s = get_state()
    pr_url = s.get("current_pr_url", "")
    k = s.get("current_task_key", "")

    if not pr_url:
        log("No PR URL")
        return

    rc, _, err = shell(f"gh pr merge {pr_url} --squash --delete-branch", timeout=30)
    if rc != 0:
        log(f"Merge failed: {err[:200]}")
        s = get_state()
        s["last_error"] = f"Merge failed: {err[:200]}"
        put_state(s)
        return

    _, merged, _ = shell(f"gh pr view {pr_url} --json state --jq '.state'", timeout=10)
    if merged and merged.strip().upper() == "MERGED":
        done = s.setdefault("build_completed_tasks", [])
        if k and k not in done:
            done.append(k)
        s["status"] = "idle"
        s["current_task_id"] = ""
        s["current_task_file"] = ""
        s["current_branch"] = ""
        s["current_pr_url"] = ""
        s["current_task_key"] = ""
        s["fix_attempts"] = 0
        s["last_error"] = ""
        push_history(s, "idle")
        put_state(s)
        log(f"MERGED {k}")
    else:
        log(f"PR state: {merged} — not merged")
        s = get_state()
        s["last_error"] = f"PR state: {merged}"
        put_state(s)

# ---------------------------------------------------------------------------
# Shell quoting
# ---------------------------------------------------------------------------

def shq(s):
    return "'" + s.replace("'", "'\\''") + "'"

# ---------------------------------------------------------------------------
# Main tick
# ---------------------------------------------------------------------------

def tick():
    log("=== Barghsa Build Loop Tick ===")

    if LOCK_FILE.exists():
        age = time.time() - LOCK_FILE.stat().st_mtime
        if age > 3600:
            LOCK_FILE.unlink(missing_ok=True)
            log("Stale lock cleared")
        else:
            log("Lock held — skip")
            return
    LOCK_FILE.touch()
    try:
        if not check_validator():
            return
        reconcile()

        s = get_state()
        status = s.get("status", "idle")
        log(f"State: {status}")

        if status == "idle":
            do_idle()
        elif status == "building":
            do_building()
        elif status == "in_review":
            do_in_review()
        elif status == "fixing":
            do_fixing()
        elif status in ("blocked", "complete"):
            log(f"Loop {status}")
        else:
            log(f"Unknown: {status}")
    finally:
        LOCK_FILE.unlink(missing_ok=True)

if __name__ == "__main__":
    try:
        tick()
    except Exception as e:
        log(f"FATAL: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        s = get_state()
        s["last_error"] = f"Runner exception: {e}"
        put_state(s)
        raise