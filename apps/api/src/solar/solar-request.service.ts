import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { OrdersService } from '../orders/orders.service.js';
import type { SolarSubmission } from './solar-request.validation.js';

export const SOLAR_AGREEMENT_VERSION = 'solar-construction-request-v1';
export const SOLAR_AGREEMENT_TEXT = 'شرایط ثبت قرارداد را می‌پذیرم.';
type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

@Injectable()
export class SolarRequestService {
  constructor(private readonly orders: OrdersService) {}

  async submit(actor: Actor, input: SolarSubmission, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true)))
        throw new NotFoundException('Profile not found');
      const existing = (
        await client.query<{ id: string; profile_id: string }>(
          'SELECT id,profile_id FROM solar_construction_requests WHERE submitted_by=$1 AND submission_key=$2',
          [actor.userId, input.submissionKey]
        )
      ).rows[0];
      if (existing) {
        if (existing.profile_id !== input.profileId)
          throw new BadRequestException('Submission key belongs to another request');
        await client.query('COMMIT');
        return { requestId: existing.id, status: 'submitted' as const };
      }
      if (input.buildingType === 'non_household') {
        const address = (
          await client.query<{ id: string }>(
            'SELECT id FROM addresses WHERE id=$1 AND profile_id=$2 AND deleted_at IS NULL FOR SHARE',
            [input.siteAddressId, input.profileId]
          )
        ).rows[0];
        if (!address) throw new BadRequestException('Select an address for this profile');
      }
      const id = uuidv7();
      await client.query(
        `INSERT INTO solar_construction_requests
         (id,profile_id,submitted_by,submission_key,status,building_type,grid_type,bill_identifier,
          property_form,structural_frame,building_completion_date,total_units,site_category,
          installation_surface,usable_area_sqm,site_address_id,site_relationship,site_description,
          agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at)
         VALUES($1,$2,$3,$4,'submitted',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                true,$18,$19,NOW())`,
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
          }),
          uuidv7(),
          ip,
        ]
      );
      await client.query('COMMIT');
      return { requestId: id, status: 'submitted' as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '23505') {
        const existing = (
          await getDbPool().query<{ id: string; profile_id: string }>(
            'SELECT id,profile_id FROM solar_construction_requests WHERE submitted_by=$1 AND submission_key=$2',
            [actor.userId, input.submissionKey]
          )
        ).rows[0];
        if (existing?.profile_id === input.profileId)
          return { requestId: existing.id, status: 'submitted' as const };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const rows = (
        await client.query(
          `SELECT id,status,building_type,grid_type,submitted_at FROM solar_construction_requests
           WHERE profile_id=$1 ORDER BY submitted_at DESC,id DESC LIMIT 100`,
          [profileId]
        )
      ).rows;
      await client.query('COMMIT');
      return { requests: rows };
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
          `SELECT r.*,a.full_address AS site_address,i.id AS initial_invoice_id,
             EXISTS(SELECT 1 FROM contract_publications cp WHERE cp.contract_id=r.contract_id) AS contract_published
           FROM solar_construction_requests r
           LEFT JOIN addresses a ON a.id=r.site_address_id
           LEFT JOIN LATERAL (
             SELECT id FROM invoices WHERE contract_id=r.contract_id::text
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
      await client.query('COMMIT');
      return { request };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
