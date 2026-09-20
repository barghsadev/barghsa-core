#!/usr/bin/env python3
"""Preview or apply a reviewed completion correction. Never resumes dispatch."""
import argparse
import fcntl
import json
import sys
from pathlib import Path

from loop_state import StateStore, completion_correction

LOCK_FILE = Path("/tmp/barghsa-loop-runner.lock")


def main(argv=None, *, lock_file=LOCK_FILE):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--remote", required=True)
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Publish the reviewed correction; default is preview")
    args = parser.parse_args(argv)
    try:
        directory = args.state_dir.resolve()
        checkout = Path(__file__).resolve().parents[2]
        if directory == checkout or checkout in directory.parents:
            raise ValueError("state directory must be outside the product checkout")
        review = json.loads(args.review.read_text())
        with lock_file.open("a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            store = StateStore(directory, args.remote)
            snapshot = store.read()
            proposed = completion_correction(snapshot, store.revision, review)
            if args.apply:
                proposed = store.correct_completion(review)
            print(json.dumps({"applied": args.apply, "state_revision": store.revision,
                              "status": proposed["status"], "event": proposed["task_events"][-1]},
                             indent=2, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"completion correction refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
