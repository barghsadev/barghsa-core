-- Add the concrete capabilities required by implemented domain endpoints.
-- Only replace unchanged predefined permission sets; retain deployment customizations.
UPDATE staff_roles SET permissions='["crm:read","crm:write","crm:edit","crm:verify","crm:edit-identity","verification:read","verification:write","profiles:read","profiles:write"]', updated_at=NOW()
WHERE role_id='role-crm-verification' AND permissions::jsonb='["crm:read","crm:write","verification:read","verification:write","profiles:read","profiles:write"]'::jsonb;
--> statement-breakpoint
UPDATE staff_roles SET permissions='["finance:read","finance:write","invoices:read","invoices:write","payments:read","payments:write","reports:read","admin:financial:edit","admin:finance:edit","admin:finance:wallet:bank-receipt-confirm","admin:finance:wallet:chargeback-alerts","admin:finance:invoices:bank-receipt-confirm","admin:finance:invoices:override-due-at","admin:finance:invoices:reminder-offsets","admin:reconciliation:view","admin:reconciliation:resolve"]', updated_at=NOW()
WHERE role_id='role-finance' AND permissions::jsonb='["finance:read","finance:write","invoices:read","invoices:write","payments:read","payments:write","reports:read"]'::jsonb;
--> statement-breakpoint
UPDATE staff_roles SET permissions='["legal:read","legal:write","contracts:read","contracts:write","compliance:read","admin:documents:edit","admin:tos:edit"]', updated_at=NOW()
WHERE role_id='role-legal-contracts' AND permissions::jsonb='["legal:read","legal:write","contracts:read","contracts:write","compliance:read"]'::jsonb;
