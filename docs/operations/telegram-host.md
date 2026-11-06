# Telegram service host

The owner designated this server for the Telegram service on 2026-11-06.

| Setting        | Value                                              |
| -------------- | -------------------------------------------------- |
| Host           | `eu.barghsa.com`                                   |
| SSH user       | `root`                                             |
| Authentication | Existing authorized SSH keys; no password required |

Connect with:

```sh
ssh root@eu.barghsa.com
```

Use the SSH identity available to the executing agent or process. No particular
private-key path was specified. Keep private keys and Telegram credentials in
protected configuration.

These are owner-provided connection details. SSH access, Telegram network access,
service deployment and live receipts have not been verified by this documentation
change. Follow the existing [staging Telegram procedure](../../deploy/staging/README.md)
for credentials, webhook handoff and receipt verification.
