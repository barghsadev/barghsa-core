# Temporary Liara rescue app

This image has Bash, an SSH **client**, and `nc`. Its public HTTP endpoint only says
`ready`; it does not run an SSH server or expose a web terminal. Use Liara's
authenticated app shell to test whether its network can reach the VPS.

1. Create a small Docker app in Liara, then authenticate the local CLI with
   `liara login`.
2. Deploy: `deploy/liara-rescue/deploy.sh YOUR_APP_NAME`.
3. Enter the app: `liara shell --app YOUR_APP_NAME`.
4. From that shell, test `nc -vz -w 5 89.42.199.13 22` and
   `nc -vz -w 5 89.42.199.13 22222`.
5. If either port connects, run `ssh -p PORT root@89.42.199.13` from the
   same shell. Verify the VPS host-key fingerprint before accepting it, and
   enter credentials interactively. Do not place passwords or private keys in
   the Dockerfile or Liara environment.

If both connections fail, this app cannot act as a jump host. An app shell
does not grant access to the VPS by itself. Delete the rescue app after use.
