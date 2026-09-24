CREATE SEQUENCE "contract_number_seq" AS bigint START WITH 1;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "contract_number" bigint;--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "contract_number" SET DEFAULT nextval('contract_number_seq'::regclass);--> statement-breakpoint
-- Terminal rows predate numbering. Their lifecycle triggers must not treat this
-- one-time metadata backfill as a business transition.
ALTER TABLE "contracts" DISABLE TRIGGER USER;--> statement-breakpoint
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS contract_number
  FROM "contracts"
)
UPDATE "contracts" AS c SET "contract_number" = numbered.contract_number
FROM numbered WHERE c.id = numbered.id;--> statement-breakpoint
ALTER TABLE "contracts" ENABLE TRIGGER USER;--> statement-breakpoint
SELECT setval('contract_number_seq',
  GREATEST(COALESCE((SELECT max(contract_number) FROM "contracts"), 0), 1),
  EXISTS(SELECT 1 FROM "contracts"));--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "contract_number" SET NOT NULL;--> statement-breakpoint
ALTER SEQUENCE "contract_number_seq" OWNED BY "contracts"."contract_number";--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_contract_number_unique" ON "contracts" USING btree ("contract_number");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contract_number_positive" CHECK ("contracts"."contract_number" > 0);
