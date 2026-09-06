-- CRM profile contacts do not confer account authentication or verified delivery.
ALTER TABLE profiles ADD COLUMN contact_email TEXT;
ALTER TABLE profiles ADD COLUMN contact_mobile TEXT;

-- Preserve the contact values previously displayed on existing CRM profiles.
-- Account credentials and historical contact-verification claims are unchanged.
UPDATE profiles p SET contact_email=u.email, contact_mobile=u.mobile
FROM users u WHERE u.user_id=p.user_id;
