-- Read-only historical review. Inactive geography is allowed for existing
-- addresses and is deliberately not treated as a mismatch here.
SELECT a.id AS address_id, a.profile_id, a.province_id, a.city_id,
       c.province_id AS actual_city_province_id
FROM addresses a
LEFT JOIN provinces p ON p.id=a.province_id
LEFT JOIN cities c ON c.id=a.city_id
WHERE p.id IS NULL OR c.id IS NULL OR c.province_id<>a.province_id;

SELECT l.id AS profile_id, l.official_province_id, l.official_city_id,
       c.province_id AS actual_city_province_id
FROM legal_profiles l
LEFT JOIN provinces p ON p.id=l.official_province_id
LEFT JOIN cities c ON c.id=l.official_city_id
WHERE l.official_province_id IS NOT NULL AND l.official_city_id IS NOT NULL
  AND (p.id IS NULL OR c.id IS NULL OR c.province_id<>l.official_province_id);
