# Branding assets

Logo and favicon uploads share the existing `branding_logo` storage purpose and
`admin:branding:edit` authority. Both accept verified PNG, JPEG or WebP images up to
2 MiB. SVG and ICO uploads are outside this path. Existing persistent HTTPS URLs
remain supported.

Saving seals independent copies of the exact verified bytes in the same versioned
branding transaction. A failed second image or audit write rolls back the draft;
durable storage-copy intents retain cleanup responsibility. Draft previews require
staff read permission and use private application URLs. Public image reads require
an active branding reference and verify stored size and digest on every read.

Migration `0278_brand_history_repair` repairs fresh installs and upgrades where
`0216` published a newer default above an older draft. It supersedes only those
obsolete drafts and preserves their content, version, creator and creation time.
Active branding and newer drafts remain unchanged. Retain repaired history on
rollback; restoring the obsolete status would recreate an invalid history.

On 2026-11-06 the owner approved retaining same-origin application asset URLs
and `Cache-Control: no-store` for v0.5.0 acceptance, replacing the specification's
CDN requirement. Any future cache must preserve private draft access and
publication changes; uploaded content alone never makes an image public.
