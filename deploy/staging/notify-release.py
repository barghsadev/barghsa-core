#!/usr/bin/env python3
"""Verify the deployed batch and announce it once, using only the Python standard library."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://stg.barghsa.com"


def release_details(root, commit):
    version = json.loads((root / "package.json").read_text())["version"]
    if not isinstance(version, str) or not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", version):
        raise ValueError("Root package version must be MAJOR.MINOR.PATCH")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Release commit must be a complete Git SHA")
    notes = (root / "releases" / f"{version}.md").read_text().strip()
    if not notes.startswith(f"Barghsa v{version}\n") or not re.search(r"(?m)^- \S", notes):
        raise ValueError("Release notes need the matching version heading and a list of changes")
    text = f"{notes}\n\nCommit: {commit}"
    if len(text.encode("utf-16-le")) // 2 > 4096:
        raise ValueError("Release notes exceed Telegram's message length limit")
    return {"version": version, "commit": commit}, text


def telegram_config():
    token = os.environ.get("BARGHSA_TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("BARGHSA_TELEGRAM_CHAT_ID")
    if not token or not chat:
        path = Path(os.environ.get("BARGHSA_TELEGRAM_CONFIG", "~/.config/barghsa/staging-telegram.json")).expanduser()
        if path.stat().st_mode & 0o077:
            raise ValueError("Telegram secret file must have permissions 600")
        config = json.loads(path.read_text())
        token = token or config.get("bot_token")
        chat = chat or config.get("chat_id")
    if not isinstance(token, str) or not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", token):
        raise ValueError("Telegram bot token is missing or malformed")
    chat = str(chat)
    if not re.fullmatch(r"-\d+|@[A-Za-z][A-Za-z0-9_]{4,31}", chat):
        raise ValueError("Telegram destination must be a channel ID or @channel name")
    return token, chat


def request_json(url, payload=None):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    if payload is not None:
        request.data = json.dumps(payload).encode()
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never print a bot URL: it contains the credential.
        raise ValueError(f"Remote request rejected with HTTP {error.code}") from None
    except (OSError, ValueError):
        raise ValueError("Remote request did not return a verifiable JSON response") from None


def telegram_call(token, method, payload):
    result = request_json(f"https://api.telegram.org/bot{token}/{method}", payload)
    if not isinstance(result, dict) or result.get("ok") is not True or not isinstance(result.get("result"), dict):
        raise ValueError("Telegram did not confirm the request")
    return result["result"]


def verify_channel(channel, destination):
    if channel.get("type") != "channel" or type(channel.get("id")) is not int:
        raise ValueError("Telegram destination is not a verified channel")
    matches = (
        str(channel["id"]) == destination if destination.startswith("-")
        else "@" + str(channel.get("username", "")).lower() == destination.lower()
    )
    if not matches:
        raise ValueError("Telegram returned a different channel")


def announce(metadata, text, token, destination, state_dir, retry_unknown=False):
    channel = telegram_call(token, "getChat", {"chat_id": destination})
    verify_channel(channel, destination)
    deployed = request_json(f"{SITE}/release.json?commit={metadata['commit']}")
    if deployed != metadata:
        raise ValueError("Deployed version/commit do not match this batch; no announcement sent")
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = hashlib.sha256(f"{channel['id']}:{metadata['commit']}".encode()).hexdigest()
    receipt_path = state_dir / f"{key}.json"
    with (state_dir / ".notification.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        receipt = {**metadata, "chat_id": channel["id"], "text_sha256": hashlib.sha256(text.encode()).hexdigest()}
        if receipt_path.exists():
            previous = json.loads(receipt_path.read_text())
            if any(previous.get(field) != value for field, value in receipt.items()):
                raise ValueError("Saved announcement identity differs from this release")
            if previous.get("status") == "sent":
                print(f"Telegram already confirmed v{metadata['version']}, message {previous['message_id']}")
                return
            if not retry_unknown:
                raise ValueError("Previous notification outcome is unknown; inspect the channel before using --retry-unknown")
        receipt_path.write_text(json.dumps({**receipt, "status": "unknown"}) + "\n")
        # No automatic send retries: a timeout can happen after Telegram publishes.
        sent = telegram_call(token, "sendMessage", {"chat_id": channel["id"], "text": text, "link_preview_options": {"is_disabled": True}})
        if type(sent.get("message_id")) is not int or sent["message_id"] <= 0 or sent.get("text") != text or sent.get("chat", {}).get("id") != channel["id"]:
            raise ValueError("Telegram message receipt did not match this release")
        receipt_path.write_text(json.dumps({**receipt, "status": "sent", "message_id": sent["message_id"]}) + "\n")
        print(f"Staging v{metadata['version']} verified; Telegram message {sent['message_id']} confirmed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--check", action="store_true", help="Validate release notes and Telegram channel before deploying")
    parser.add_argument("--retry-unknown", action="store_true", help="Retry only after manually checking the channel for a prior message")
    args = parser.parse_args()
    metadata, text = release_details(ROOT, args.commit)
    current = subprocess.check_output(["rtk", "proxy", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(["rtk", "proxy", "git", "status", "--porcelain"], cwd=ROOT, text=True)
    if current != args.commit or dirty:
        raise ValueError("Release checkout changed; commit the batch and retry from its exact HEAD")
    token, destination = telegram_config()
    if args.check:
        verify_channel(telegram_call(token, "getChat", {"chat_id": destination}), destination)
        print(f"Release preflight passed for v{metadata['version']}")
        return
    state = Path(os.environ.get("BARGHSA_RELEASE_STATE_DIR", "~/.local/state/barghsa-staging-releases")).expanduser()
    announce(metadata, text, token, destination, state, args.retry_unknown)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError):
        # File/network errors can embed credentials. Print only safe validation errors.
        error = sys.exc_info()[1]
        print(f"Release notification failed: {error if isinstance(error, ValueError) else type(error).__name__}", file=sys.stderr)
        sys.exit(1)
