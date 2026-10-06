#!/usr/bin/env python3
"""Verify a deployed release and announce one summary and at most one image album."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
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
    if not notes.startswith(f"برقسا نسخه {version}\n") or not re.search(r"(?m)^- \S", notes):
        raise ValueError("Release notes need the matching version heading and a list of changes")
    text = f"{notes}\n\nمحیط آزمایشی: {SITE}\nشناسه کد: {commit}"
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


def request_json(url, payload=None, photo=None):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    if photo is not None:
        boundary = "barghsa-" + secrets.token_hex(16)
        parts = []
        for key, value in payload.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        attachments = {f"image{i}": data for i, data in enumerate(photo)} if isinstance(photo, list) else {"photo": photo}
        for name, data in attachments.items():
            filename = "screenshot.png" if name == "photo" else f"{name}.png"
            parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n'.encode(), data, b"\r\n"])
        parts.append(f'--{boundary}--\r\n'.encode())
        request.data = b"".join(parts)
        request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    elif payload is not None:
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


def telegram_call(token, method, payload, photo=None):
    result = request_json(f"https://api.telegram.org/bot{token}/{method}", payload, photo)
    result_type = list if method == "sendMediaGroup" else dict
    if not isinstance(result, dict) or result.get("ok") is not True or not isinstance(result.get("result"), result_type):
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


def screenshot_bytes(path):
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > 10 * 1024 * 1024:
        raise ValueError("Screenshots must be PNG images no larger than 10 MB")
    return data


def announce_screenshots(metadata, token, destination, state_dir, images, retry_unknown=False):
    if not 1 <= len(images) <= 10:
        raise ValueError("Use one photo or one album of at most ten screenshots; link a gallery for extras")
    channel = telegram_call(token, "getChat", {"chat_id": destination})
    verify_channel(channel, destination)
    if request_json(f"{SITE}/release.json?commit={metadata['commit']}") != metadata:
        raise ValueError("Deployed release changed; screenshots were not announced")
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state_dir / ".notification.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        hashes = [hashlib.sha256(data).hexdigest() for data in images]
        receipt = {**metadata, "chat_id": channel["id"], "photo_sha256": hashes}
        key = hashlib.sha256(f"{channel['id']}:{metadata['commit']}".encode()).hexdigest()
        path = state_dir / f"album-{key}.json"
        if path.exists():
            prior = json.loads(path.read_text())
            if any(prior.get(field) != value for field, value in receipt.items()):
                raise ValueError("Saved screenshot selection differs from this release; no additional post allowed")
            if prior.get("status") == "sent":
                print("Release screenshots already confirmed as one grouped update")
                return
            if not retry_unknown:
                raise ValueError("Previous screenshot outcome is unknown; inspect the channel before using --retry-unknown")
        else:
            legacy = [json.loads(p.read_text()) for p in state_dir.glob("photo-*.json")]
            legacy = [r for r in legacy if r.get("commit") == metadata['commit'] and r.get("chat_id") == channel['id']]
            if legacy:
                confirmed = {r['photo_sha256'] for r in legacy if r.get('status') == 'sent'}
                if set(hashes) <= confirmed:
                    print("Legacy release screenshots already confirmed; no new album sent")
                    return
                raise ValueError("Legacy screenshot receipts require channel inspection; no new album sent")
        path.write_text(json.dumps({**receipt, "status": "unknown"}) + "\n")
        caption = f"تصویر محیط آزمایشی برقسا، نسخه {metadata['version']}"
        if len(images) == 1:
            sent = [telegram_call(token, "sendPhoto", {"chat_id": channel["id"], "caption": caption}, images[0])]
        else:
            media = [{"type": "photo", "media": f"attach://image{i}", **({"caption": caption} if i == 0 else {})} for i in range(len(images))]
            sent = telegram_call(token, "sendMediaGroup", {"chat_id": channel["id"], "media": json.dumps(media, ensure_ascii=False)}, images)
        if not isinstance(sent, list) or len(sent) != len(images) or any(
            not isinstance(row, dict) or type(row.get('message_id')) is not int or row['message_id'] <= 0
            or not isinstance(row.get('chat'), dict) or row['chat'].get('id') != channel['id']
            or not isinstance(row.get('photo'), list) or not row['photo'] for row in sent
        ) or sent[0].get('caption') != caption or len({row['message_id'] for row in sent}) != len(sent):
            raise ValueError("Telegram screenshot receipt did not match this release")
        if len(images) > 1 and (not isinstance(sent[0].get('media_group_id'), str) or not sent[0]['media_group_id'] or any(row.get('media_group_id') != sent[0]['media_group_id'] for row in sent)):
            raise ValueError("Telegram album receipt did not confirm one grouped update")
        ids = [row['message_id'] for row in sent]
        path.write_text(json.dumps({**receipt, "status": "sent", "message_ids": ids, "media_group_id": sent[0].get('media_group_id')}) + "\n")
        print(f"Release screenshots confirmed as one grouped update, messages {ids}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--check", action="store_true", help="Validate release notes and Telegram channel before deploying")
    parser.add_argument("--retry-unknown", action="store_true", help="Retry only after manually checking the channel for a prior message")
    parser.add_argument("--screenshot", action="append", type=Path, default=[], help="Attach a PNG screenshot after the Persian release notes; repeat for multiple images")
    args = parser.parse_args()
    metadata, text = release_details(ROOT, args.commit)
    current = subprocess.check_output(["rtk", "proxy", "git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(["rtk", "proxy", "git", "status", "--porcelain"], cwd=ROOT, text=True)
    if current != args.commit or dirty:
        raise ValueError("Release checkout changed; commit the batch and retry from its exact HEAD")
    token, destination = telegram_config()
    images = [screenshot_bytes(path) for path in args.screenshot]
    if len(images) > 10:
        raise ValueError("At most ten screenshots can accompany one release update")
    if args.check:
        verify_channel(telegram_call(token, "getChat", {"chat_id": destination}), destination)
        print(f"Release preflight passed for v{metadata['version']}")
        return
    state = Path(os.environ.get("BARGHSA_RELEASE_STATE_DIR", "~/.local/state/barghsa-staging-releases")).expanduser()
    announce(metadata, text, token, destination, state, args.retry_unknown)
    if images:
        announce_screenshots(metadata, token, destination, state, images, args.retry_unknown)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError):
        # File/network errors can embed credentials. Print only safe validation errors.
        error = sys.exc_info()[1]
        print(f"Release notification failed: {error if isinstance(error, ValueError) else type(error).__name__}", file=sys.stderr)
        sys.exit(1)
