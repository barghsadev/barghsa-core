# Password reset expiry test reliability — September 24, 2026

The password-reset rollback test occasionally failed under CI load before the reset transaction reached its deliberate database lock. The two-second OTP window expired during hashing, so the test observed no blocked transaction and never exercised the intended rollback. The test now allows four seconds to reach the lock, polls for it explicitly, then waits for expiry before releasing it. This remains inside the application's five-second database lock timeout. The credential, session, refresh-token and audit rollback assertions are unchanged.

Validation: focused password-reset HTTP integration suite, API typecheck, targeted lint and formatting. CI status follows the direct `main` push.
