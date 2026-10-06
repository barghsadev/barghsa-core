#!/usr/bin/env python3
"""Compatibility check for older callers. The board is the sole status source."""
import sys
from board import main
if __name__ == '__main__':
    if sys.argv[1:] != ['--check']:
        raise SystemExit('Legacy backlog generation is retired. Use board.py render or check.')
    sys.argv = [sys.argv[0], 'check']
    raise SystemExit(main())
