import { Inject, Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  REMINDER_OFFSET_TOGGLE_EVENT,
  mergeReminderOffsetToggles,
  parseReminderOffsetToggleBody,
  type ReminderOffsetToggleDto,
} from '@barghsa/shared/finance'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Admin reminder-offset toggle service (T-04.1.04.05 / S-04.1.04).
 *
 * Reads and upserts `invoice_reminder_offset_toggles` so each canonical
 * offset can be enabled or disabled per service type. Missing pairs are
 * served as enabled (the S-04.1.04 default schedule). Writes are a
 * single-row UPSERT under a transaction and record an audit event.
 *
 * Permission `admin:finance:invoices:reminder-offsets` is enforced at
 * the controller boundary (mapped to platform admin today).
 */

export interface SetReminderOffsetToggleInput {
  raw: unknown
  actorUserId: string
  ip: string
}

interface StoredToggleRow {
  service_type: string
  offset: number
  enabled: boolean
}

@Injectable()
export class ReminderOffsetToggleService {
  private readonly logger = new Logger(ReminderOffsetToggleService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
  ) {}

  /**
   * Return the full 4×6 matrix. Stored rows overlay the defaults; missing
   * pairs stay enabled so an empty table matches the canonical schedule.
   */
  async list(): Promise<ReminderOffsetToggleDto[]> {
    const pool = getDbPool()
    const result = await pool.query<StoredToggleRow>(
      `SELECT service_type, "offset", enabled
         FROM invoice_reminder_offset_toggles`,
    )
    return mergeReminderOffsetToggles(
      result.rows.map((row) => ({
        serviceType: row.service_type,
        offset: Number(row.offset),
        enabled: row.enabled,
      })),
    )
  }

  /**
   * Upsert one (serviceType, offset) enable flag. Validation failures
   * throw 400. Concurrent writers serialize on the unique pair.
   */
  async set(input: SetReminderOffsetToggleInput): Promise<ReminderOffsetToggleDto[]> {
    const parsed = parseReminderOffsetToggleBody(input.raw)
    if (!parsed.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: parsed.issues.join('; '),
        },
        400,
      )
    }

    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()
    try {
      await client.query('BEGIN')

      const previous = await client.query<StoredToggleRow>(
        `SELECT service_type, "offset", enabled
           FROM invoice_reminder_offset_toggles
          WHERE service_type = $1 AND "offset" = $2
          FOR UPDATE`,
        [parsed.value.serviceType, parsed.value.offset],
      )

      await client.query(
        `INSERT INTO invoice_reminder_offset_toggles
           (service_type, "offset", enabled, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (service_type, "offset")
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by`,
        [parsed.value.serviceType, parsed.value.offset, parsed.value.enabled, input.actorUserId],
      )

      const auditId = uuidv7()
      const correlationId = this.correlationIdProvider.getCorrelationId() ?? uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          auditId,
          input.actorUserId,
          REMINDER_OFFSET_TOGGLE_EVENT,
          JSON.stringify({
            serviceType: parsed.value.serviceType,
            offset: parsed.value.offset,
            enabled: parsed.value.enabled,
            previousEnabled: previous.rows[0]?.enabled ?? true,
          }),
          correlationId,
          input.ip,
          now,
        ],
      )

      const all = await client.query<StoredToggleRow>(
        `SELECT service_type, "offset", enabled
           FROM invoice_reminder_offset_toggles`,
      )

      await client.query('COMMIT')

      this.logger.log(
        `Reminder offset ${parsed.value.serviceType}/${parsed.value.offset} ` +
          `set enabled=${parsed.value.enabled} by ${input.actorUserId}`,
      )

      return mergeReminderOffsetToggles(
        all.rows.map((row) => ({
          serviceType: row.service_type,
          offset: Number(row.offset),
          enabled: row.enabled,
        })),
      )
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      this.logger.error(`Failed to set reminder offset toggle: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update reminder offset toggle' },
        500,
      )
    } finally {
      client.release()
    }
  }
}
