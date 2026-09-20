#!/usr/bin/env python3
"""Retired legacy entry point. Historical snapshots are never live dispatch state."""
import sys


def main():
    print(
        "transition_state.py is retired; no state was changed. "
        "Builders must write the assignment-bound external handoff. "
        "Only the deterministic supervisor may persist live transitions. "
        "See kanban/STATE-PROTOCOL.md for reconciliation and recovery.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
