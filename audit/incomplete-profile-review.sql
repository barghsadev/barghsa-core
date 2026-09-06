-- Read-only review of historical non-draft profiles that may have used the
-- former empty-finalization path. Review the owning workflow before repair;
-- do not bulk downgrade approved profiles or alter orders automatically.
SELECT p.id, p.profile_type, p.status,
       EXISTS (SELECT 1 FROM addresses a WHERE a.profile_id=p.id AND a.main_address) AS has_main_address,
       CASE WHEN p.profile_type='INDIVIDUAL'
            THEN NULLIF(btrim(p.first_name),'') IS NOT NULL
             AND NULLIF(btrim(p.last_name),'') IS NOT NULL
             AND NULLIF(btrim(p.national_id),'') IS NOT NULL
            ELSE l.id IS NOT NULL END AS has_identity_record
FROM profiles p
LEFT JOIN legal_profiles l ON l.id=p.id
WHERE p.status<>'DRAFT' AND NOT p.archived
  AND (NOT EXISTS (SELECT 1 FROM addresses a WHERE a.profile_id=p.id AND a.main_address)
    OR (p.profile_type='INDIVIDUAL' AND
      (NULLIF(btrim(p.first_name),'') IS NULL OR NULLIF(btrim(p.last_name),'') IS NULL
       OR NULLIF(btrim(p.national_id),'') IS NULL))
    OR (p.profile_type='LEGAL' AND l.id IS NULL));
