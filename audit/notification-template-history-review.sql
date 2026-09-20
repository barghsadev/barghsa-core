-- Read-only inventory. Publication version numbers must not be silently reassigned.
SELECT event_key, channel, locale, version, count(*) AS duplicate_count,
       array_agg(id ORDER BY created_at,id) AS template_ids,
       array_agg(status ORDER BY created_at,id) AS statuses
FROM notification_templates
GROUP BY event_key, channel, locale, version
HAVING count(*) > 1
ORDER BY event_key, channel, locale, version;

SELECT id, event_key, channel, locale, version, status, published_at
FROM notification_templates
WHERE version <= 0
ORDER BY event_key, channel, locale, version;
