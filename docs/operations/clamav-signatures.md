# ClamAV signature freshness

A healthy daemon must also have current signature data. Compare the daemon's version with the vendor's signed update feed before selecting a scanner image. Record the loaded signature version and the result of clean and infected test uploads. A successful PING only proves the daemon is running.

If FreshClam receives HTTP 403, preserve the cooldown and investigate the reason. Do not repeatedly retry or substitute an unsigned download. An approved [private ClamAV mirror](https://docs.clamav.net/appendix/CvdPrivateMirror.html) can serve vendor updates over HTTPS. Use only a host and feed authorized for this deployment. Restrict access to the scanner hosts, verify signatures and freshness before reload, and alert on overdue updates.

For the tested Alpine scanner, create a separate signature volume owned by the new scanner UID and GID. Keep the previous volume untouched for rollback. Test updates and scanning in isolation before changing the active image, then verify the loaded version and repeat clean and infected checks. The normal app release does not switch the PostgreSQL or ClamAV images.
