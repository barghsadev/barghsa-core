# Session location

For v0.6.0, Settings → Security shows “Location unavailable” for every session. The owner approved removing the bundled GeoLite2 dataset on 2026-11-09. The session API keeps its optional country display contract and returns `location: null`. The existing authenticated session history, device details, device trust, authentication and revocation are unchanged. Location never affects an access decision. The server makes no external IP lookup.

The earlier release used the offline IPv4/IPv6 data in `geoip-country@5.0.202609050122`. That dependency and its data are excluded from the v0.6.0 candidate. The [package review](release-license-review.md#geolite2-decision) records why the old data was retired.

Before reintroducing country display, obtain approval for a maintained offline source and establish license, attribution, freshness and retirement requirements. Keep the dataset outside immutable application images and prove the refresh, expiry and purge process covers deploys and rollback copies. Keep the fallback on missing or expired data and never send session IPs to another service.
