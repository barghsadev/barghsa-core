import { HttpException, NotFoundException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'

/** Call inside the transaction, before taking the wallet lock. */
export async function lockActiveTopUpProfile(client: {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
}, profileId: string): Promise<void> {
  const result = await client.query('SELECT archived FROM profiles WHERE id=$1 FOR SHARE', [profileId])
  const profile = result.rows[0] as { archived: boolean } | undefined
  if (!profile) throw new NotFoundException('Profile not found')
  if (profile.archived !== false) throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'Archived profiles cannot start wallet top-ups' }, 409)
}
