import {
  literalSearchPattern,
  DEFAULT_HISTORY_SORT,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { readWizardDraftTtl } from '../common/wizard-draft-retention.js';
import type { FinancialReviewSnapshot } from '@barghsa/shared/finance';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { OrdersService } from '../orders/orders.service.js';
import type {
  SolarDraftInput,
  SolarSubmission,
  SolarSubmissionReviewInput,
} from './solar-request.validation.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { readSolarProgress } from './solar-progress-projection.js';

export const SOLAR_AGREEMENT_VERSION = 'solar-construction-request-v1';
export const SOLAR_AGREEMENT_TEXT = 'شرایط ثبت قرارداد را می‌پذیرم.';
type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

@Injectable()
export class SolarRequestService {
  constructor(private readonly orders: OrdersService) {}
  private readonly reviews = new ReviewSnapshotService();

  private reviewScope(input: SolarSubmissionReviewInput) {
    return {
      action: 'solar.request.submit',
      profileId: input.profileId,
      resourceId: input.submissionKey,
    };
  }

  private assertReplay(
    stored: FinancialReviewSnapshot<Record<string, unknown>> | null,
    input: SolarSubmissionReviewInput,
    expectedHash?: string
  ) {
    if (!stored)
      throw new ConflictException(
        'This submission predates request review; use a new submission key'
      );
    this.reviews.assertConfirmed(stored, expectedHash ?? stored.hash);
    if (
      stored.scope.action !== 'solar.request.submit' ||
      stored.scope.profileId !== input.profileId ||
      stored.scope.resourceId !== input.submissionKey
    )
      throw new ConflictException('Submission key belongs to another request');
    const updated = this.reviews.create(this.reviewScope(input), {
      ...stored.data,
      submission: input,
    });
    this.reviews.assertConfirmed(updated, stored.hash);
    return stored;
  }

  private async siteAddress(client: PoolClient, input: SolarSubmissionReviewInput) {
    if (!input.siteAddressId) throw new BadRequestException('Select an address for this profile');
    const address = (
      await client.query<{
        id: string;
        province_id: string;
        city_id: string;
        full_address: string;
        postal_code: string;
      }>(
        'SELECT id,province_id,city_id,full_address,postal_code FROM addresses WHERE id=$1 AND profile_id=$2 AND deleted_at IS NULL FOR SHARE',
        [input.siteAddressId, input.profileId]
      )
    ).rows[0];
    if (!address) throw new BadRequestException('Select an address for this profile');
    return address;
  }

  private async submissionReviewData(client: PoolClient, submission: SolarSubmissionReviewInput) {
    const address = await this.siteAddress(client, submission);
    return {
      submission,
      siteAddress: address?.full_address ?? null,
      siteAddressSnapshot: address,
      agreementVersion: SOLAR_AGREEMENT_VERSION,
      agreementText: SOLAR_AGREEMENT_TEXT,
      createsContract: false,
      createsInvoice: false,
    };
  }

  async review(actor: Actor, input: SolarSubmissionReviewInput) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true)))
        throw new NotFoundException('Profile not found');
      await this.orders.lockProfileSubmissions(client, input.profileId);
      const existing = (
        await client.query<{
          profile_id: string;
          submission_review: FinancialReviewSnapshot<Record<string, unknown>> | null;
        }>(
          'SELECT profile_id,submission_review FROM solar_construction_requests WHERE submitted_by=$1 AND submission_key=$2',
          [actor.userId, input.submissionKey]
        )
      ).rows[0];
      if (existing && existing.profile_id !== input.profileId)
        throw new ConflictException('Submission key belongs to another request');
      const review = existing
        ? this.assertReplay(existing.submission_review, input)
        : this.reviews.create(
            this.reviewScope(input),
            await this.submissionReviewData(client, input)
          );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getDraft(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId, true)))
        throw new NotFoundException('Profile not found');
      const ttlDays = await readWizardDraftTtl(client);
      await client.query(
        "DELETE FROM solar_customer_drafts WHERE user_id=$1 AND profile_id=$2 AND updated_at < NOW() - ($3::integer * INTERVAL '1 day')",
        [actor.userId, profileId, ttlDays]
      );
      const row = (
        await client.query<{
          current_step: number;
          data: SolarDraftInput['data'];
          updated_at: Date;
        }>(
          'SELECT current_step,data,updated_at FROM solar_customer_drafts WHERE user_id=$1 AND profile_id=$2',
          [actor.userId, profileId]
        )
      ).rows[0];
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return row
        ? { currentStep: row.current_step, data: row.data, updatedAt: row.updated_at.toISOString() }
        : { currentStep: 1, data: null, updatedAt: null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async saveDraft(actor: Actor, input: SolarDraftInput) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true)))
        throw new NotFoundException('Profile not found');
      const saved = await client.query<{
        current_step: number;
        data: SolarDraftInput['data'];
        updated_at: Date;
      }>(
        `INSERT INTO solar_customer_drafts(user_id,profile_id,current_step,data)
           VALUES($1,$2,$3,$4::jsonb)
           ON CONFLICT(user_id,profile_id) DO UPDATE SET current_step=EXCLUDED.current_step,data=EXCLUDED.data,updated_at=NOW()
             WHERE solar_customer_drafts.data IS DISTINCT FROM EXCLUDED.data OR solar_customer_drafts.current_step IS DISTINCT FROM EXCLUDED.current_step
           RETURNING current_step,data,updated_at`,
        [actor.userId, input.profileId, input.currentStep, JSON.stringify(input.data)]
      );
      if (saved.rows.length) {
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
           VALUES(uuid_generate_v7(),$1,'solar.request.draft_saved',jsonb_build_object('profileId',$2::text,'step',$3::integer),uuid_generate_v7())`,
          [actor.userId, input.profileId, input.currentStep]
        );
      }
      const row =
        saved.rows[0] ??
        (
          await client.query<{
            current_step: number;
            data: SolarDraftInput['data'];
            updated_at: Date;
          }>(
            'SELECT current_step,data,updated_at FROM solar_customer_drafts WHERE user_id=$1 AND profile_id=$2',
            [actor.userId, input.profileId]
          )
        ).rows[0]!;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        currentStep: row.current_step,
        data: row.data,
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(actor: Actor, input: SolarSubmission, ip: string) {
    const client = await getDbPool().connect();
    const { expectedReviewHash, ...submission } = input;
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const existing = (
        await client.query<{
          id: string;
          profile_id: string;
          submission_review: FinancialReviewSnapshot<Record<string, unknown>> | null;
        }>(
          'SELECT id,profile_id,submission_review FROM solar_construction_requests WHERE submitted_by=$1 AND submission_key=$2',
          [actor.userId, input.submissionKey]
        )
      ).rows[0];
      if (
        !(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true, !existing))
      )
        throw new NotFoundException('Profile not found');
      await this.orders.lockProfileSubmissions(client, input.profileId);
      if (existing) {
        if (existing.profile_id !== input.profileId)
          throw new ConflictException('Submission key belongs to another request');
        this.assertReplay(existing.submission_review, submission, expectedReviewHash);
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return { requestId: existing.id, status: 'submitted' as const };
      }
      await this.orders.enforceProfileSubmissionLimit(client, input.profileId);
      const review = this.reviews.create(
        this.reviewScope(submission),
        await this.submissionReviewData(client, submission)
      );
      this.reviews.assertConfirmed(review, expectedReviewHash);
      const id = uuidv7();
      await client.query(
        `INSERT INTO solar_construction_requests
         (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,bill_identifier,
          property_form,structural_frame,building_completion_date,total_units,site_category,
          installation_surface,usable_area_sqm,site_address_id,site_relationship,site_description,
          agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at,submission_review)
         VALUES($1,$2,$3,$4,'submitted',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                true,$18,$19,NOW(),$20::jsonb)`,
        [
          id,
          input.profileId,
          actor.userId,
          input.submissionKey,
          input.buildingType,
          input.gridType,
          input.gridType === 'on_grid' ? input.billIdentifier : null,
          input.buildingType === 'building_apartment' ? input.propertyForm : null,
          input.buildingType === 'building_apartment' ? input.structuralFrame : null,
          input.buildingType === 'building_apartment' ? input.buildingCompletionDate : null,
          input.buildingType === 'building_apartment' && input.propertyForm === 'apartment'
            ? input.totalUnits
            : null,
          input.buildingType === 'non_household' ? input.siteCategory : null,
          input.buildingType === 'non_household' ? input.installationSurface : null,
          input.buildingType === 'non_household' ? input.usableAreaSqm : null,
          input.buildingType === 'non_household' ? input.siteAddressId : null,
          input.buildingType === 'non_household' ? input.siteRelationship : null,
          input.buildingType === 'non_household' ? (input.siteDescription ?? null) : null,
          SOLAR_AGREEMENT_VERSION,
          SOLAR_AGREEMENT_TEXT,
          JSON.stringify(review),
        ]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES($1,$2,'solar.request.submitted',$3::jsonb,$4,$5)`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({
            requestId: id,
            profileId: input.profileId,
            agreementVersion: SOLAR_AGREEMENT_VERSION,
            reviewHash: review.hash,
          }),
          uuidv7(),
          ip,
        ]
      );
      await client.query('DELETE FROM solar_customer_drafts WHERE user_id=$1 AND profile_id=$2', [
        actor.userId,
        input.profileId,
      ]);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { requestId: id, status: 'submitted' as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '23505') {
        const existing = (
          await getDbPool().query<{
            id: string;
            profile_id: string;
            submission_review: FinancialReviewSnapshot<Record<string, unknown>> | null;
          }>(
            'SELECT id,profile_id,submission_review FROM solar_construction_requests WHERE submitted_by=$1 AND submission_key=$2',
            [actor.userId, input.submissionKey]
          )
        ).rows[0];
        if (existing?.profile_id === input.profileId) {
          this.assertReplay(existing.submission_review, submission, expectedReviewHash);
          return { requestId: existing.id, status: 'submitted' as const };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(
    actor: Actor,
    profileId: string,
    before?: string,
    statuses: readonly string[] = [],
    range: DateRangeFilterValue = {},
    query: HistoryQuery = { q: '', sort: DEFAULT_HISTORY_SORT }
  ) {
    const direction = query.sort === 'submitted_at:asc' ? 'ASC' : 'DESC';
    const comparison = direction === 'ASC' ? '>' : '<';
    const pattern = literalSearchPattern(query.q);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const cursor = before
        ? (
            await client.query<{ id: string; submitted_at: string }>(
              `SELECT r.id,r.submitted_at::text AS submitted_at FROM solar_construction_requests r
               WHERE r.id=$1 AND r.profile_id=$2 AND (cardinality($3::text[])=0 OR r.status=ANY($3::text[]))
                 AND ($4::timestamptz IS NULL OR r.submitted_at >= $4::timestamptz)
                 AND ($5::timestamptz IS NULL OR r.submitted_at < $5::timestamptz)
                 AND ($6::text IS NULL OR r.id::text ILIKE $6::text)`,
              [before, profileId, statuses, range.from ?? null, range.to ?? null, pattern]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Solar request cursor not found');
      const rows = (
        await client.query(
          `SELECT r.id,r.status,r.building_type,r.grid_type,r.submitted_at,r.contract_id,
                 i.id AS initial_invoice_id,i.state AS initial_invoice_state,
                 EXISTS(
                   SELECT 1 FROM contract_publications cp WHERE cp.contract_id=r.contract_id
                 ) AS contract_published
                 FROM solar_construction_requests r
                 LEFT JOIN LATERAL (
                   SELECT id,state FROM invoices WHERE contract_id=r.contract_id::text
                   ORDER BY issued_at,id LIMIT 1
                 ) i ON r.contract_id IS NOT NULL
                 WHERE r.profile_id=$1
                 AND ($2::timestamptz IS NULL OR (r.submitted_at,r.id) ${comparison} ($2::timestamptz,$3::uuid))
                 AND (cardinality($4::text[])=0 OR r.status=ANY($4::text[]))
                 AND ($5::timestamptz IS NULL OR r.submitted_at >= $5::timestamptz)
                 AND ($6::timestamptz IS NULL OR r.submitted_at < $6::timestamptz)
               AND ($7::text IS NULL OR r.id::text ILIKE $7::text)
             ORDER BY r.submitted_at ${direction},r.id ${direction} LIMIT 101`,
          [
            profileId,
            cursor?.submitted_at ?? null,
            before ?? null,
            statuses,
            range.from ?? null,
            range.to ?? null,
            pattern,
          ]
        )
      ).rows;
      await client.query('COMMIT');
      return {
        requests: rows.slice(0, 100),
        nextBefore: rows.length > 100 ? rows[99]!.id : null,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(actor: Actor, id: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query<Record<string, unknown>>(
          `SELECT r.*,r.submission_review->'data'->>'siteAddress' AS site_address,
               i.id AS initial_invoice_id,
               i.state AS initial_invoice_state,
               EXISTS(SELECT 1 FROM contract_publications cp WHERE cp.contract_id=r.contract_id) AS contract_published
           FROM solar_construction_requests r
           LEFT JOIN LATERAL (
               SELECT id,state FROM invoices WHERE contract_id=r.contract_id::text
             ORDER BY issued_at,id LIMIT 1
           ) i ON r.contract_id IS NOT NULL
           WHERE r.id=$1`,
          [id]
        )
      ).rows[0];
      if (
        !request ||
        !(await this.orders.mayManageOrders(client, actor.userId, request.profile_id as string))
      )
        throw new NotFoundException('Solar request not found');
      const history = (
        await client.query<{ event: string; created_at: Date; actor_context: string }>(
          `SELECT event,created_at,COALESCE(operating_context,'unknown') AS actor_context FROM audit_log
           WHERE event LIKE 'solar.%' AND metadata IS NOT NULL
             AND metadata::jsonb->>'requestId'=$1
             AND event IN (
               'solar.request.submitted','solar.documents.submitted',
               'solar.documents.additional_requested','solar.documents.approved_for_postal',
               'solar.postal.shipped','solar.postal.received',
               'solar.postal.incomplete','solar.postal.not_received',
               'solar.final.review_started','solar.final.approve',
               'solar.final.reject','solar.final.close-no-contract',
               'solar.contract.created'
             )
           ORDER BY created_at,id`,
          [id]
        )
      ).rows.map((row) => ({
        event: row.event,
        at: row.created_at.toISOString(),
        actorContext: row.actor_context,
      }));
      const progress = await readSolarProgress(client, id);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { request, history, progress };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
