# Signed contract amendments

Canonical scope: `04-invoices-wallet-contracts.md#T-04.5.02.04` and the signature and document-linking requirements of `T-04.5.04.02` through `.05`.

Staff can draft and publish a new contract version while the accepted base stays effective. The customer reviews and accepts that exact version. If its activation rules require a signature, acceptance moves the amendment to `AwaitingSignature`; an approved exact-version amendment PDF supports a signing request, and an approved signed copy applies the new version. The base remains current until signed evidence is recorded. Unsigned amendments apply on acceptance. Version history, linked documents, financial review and bilingual customer/staff controls follow these states. Paid active electricity amendments carry their existing invoice and service period into the new version.

Direct `main` commits: `de16253a`, `2a83ee1b`, `434737ce`, `a158980f`, `3399b59a`, and `70d41cab`. The final batch passed 59 focused contract/document HTTP tests, 950 database tests, 1,087 web tests, root build/typecheck/lint/format, OpenAPI, schema snapshot and backlog validation. GitHub CI for `70d41cab` was still running when this record was written.

