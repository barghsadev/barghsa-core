ALTER TABLE "service_breach_alerts" DROP CONSTRAINT "chk_sba_service_type";--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN "policy_fingerprint" text;--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD CONSTRAINT "chk_sba_workflow_snapshot" CHECK ("service_breach_alerts"."service_type" NOT LIKE 'workflow_%' OR
      ("service_breach_alerts"."source_activity_at" IS NOT NULL AND "service_breach_alerts"."policy_fingerprint" IS NOT NULL AND "service_breach_alerts"."policy_fingerprint" ~ '^[a-f0-9]{64}$'));--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD CONSTRAINT "chk_sba_service_type" CHECK ("service_breach_alerts"."service_type" IN ('ticket','verification_case','consultation',
        'workflow_ticket_low','workflow_ticket_normal','workflow_ticket_high','workflow_ticket_urgent',
        'workflow_verification','workflow_consultation','workflow_electricity_order','workflow_saving_order',
        'workflow_solar_order','workflow_electricity_contract','workflow_saving_contract','workflow_solar_contract'));