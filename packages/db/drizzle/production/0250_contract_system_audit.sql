-- Replace only future automatic audit payloads. Existing immutable history and
-- activation/completion guards, locks, evidence and business effects stay intact.
CREATE OR REPLACE FUNCTION apply_contract_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_state contract_state;
BEGIN
 SELECT state INTO previous_state FROM contracts WHERE id=NEW.contract_id;
 UPDATE contracts SET state='Active',activated_at=NEW.activated_at WHERE id=NEW.contract_id;
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
 SELECT gen_random_uuid(),p.user_id,'contract.activated',jsonb_build_object('actor','system','entity','contract','entityId',NEW.contract_id,'fromState',previous_state,'toState','Active','reason',NULL,'profileId',c.profile_id,'profileOwnerUserId',p.user_id,'contractId',NEW.contract_id,'versionId',NEW.version_id,'actorType','system','activatedAt',NEW.activated_at),gen_random_uuid(),'127.0.0.1'
 FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_contract_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_state contract_state;
BEGIN
 SELECT state INTO previous_state FROM contracts WHERE id=NEW.contract_id;
 UPDATE contracts SET state='Completed',completed_at=NEW.completed_at WHERE id=NEW.contract_id;
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
 SELECT gen_random_uuid(),p.user_id,'contract.completed',jsonb_build_object('actor','system','entity','contract','entityId',NEW.contract_id,'fromState',previous_state,'toState','Completed','reason',NULL,'profileId',c.profile_id,'profileOwnerUserId',p.user_id,'contractId',NEW.contract_id,'versionId',NEW.version_id,'actorType','system','completedAt',NEW.completed_at,'financialClosure',false),gen_random_uuid(),'127.0.0.1'
 FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id;
 RETURN NULL;
END $$;
