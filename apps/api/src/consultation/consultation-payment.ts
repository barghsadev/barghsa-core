import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { NotificationsService } from '../notifications/notifications.service.js';
import { tConsultation } from '@barghsa/i18n/consultation';

/** Called while the invoice and its transaction are locked; a paid invoice settles an accepted offer. */
export async function settlePaidConsultation(
  client: PoolClient,
  consultationId: string,
  invoiceId: string,
  paymentActorId: string
): Promise<boolean> {
  const row = (
    await client.query<{
      id: string;
      profile_id: string;
      status: string;
      invoice_id: string | null;
      accepted_by: string | null;
      submitted_by: string;
      profile_user_id: string;
    }>(
      `SELECT r.id,r.profile_id,r.status,r.invoice_id,r.accepted_by,r.submitted_by,
       p.user_id AS profile_user_id
       FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
       WHERE r.id=$1 FOR UPDATE OF r`,
      [consultationId]
    )
  ).rows[0];
  if (!row || row.invoice_id !== invoiceId || row.status !== 'offer_pending' || !row.accepted_by)
    return false;
  await client.query(
    "UPDATE consultation_requests SET status='offer_accepted',expected_next_step=NULL,updated_at=NOW() WHERE id=$1",
    [row.id]
  );
  await client.query(
    `INSERT INTO consultation_request_events(id,request_id,status,actor_user_id,reason)
     VALUES($1,$2,'offer_accepted',$3,$4)`,
    [uuidv7(), row.id, row.accepted_by, 'Accepted offer paid']
  );
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES($1,$2,'consultation.offer.paid',$3::jsonb,$4,'127.0.0.1')`,
    [
      uuidv7(),
      paymentActorId,
      JSON.stringify({ requestId: row.id, invoiceId, acceptedBy: row.accepted_by }),
      uuidv7(),
    ]
  );
  for (const userId of new Set([row.profile_user_id, row.submitted_by])) {
    await new NotificationsService().create(
      {
        userId,
        profileId: row.profile_id,
        type: 'general',
        title: 'Consultation offer accepted',
        localizedContent: {
          fa: {
            title: 'پیشنهاد مشاوره پذیرفته شد',
            body: `وضعیت درخواست مشاوره: ${tConsultation('status_offer_accepted', 'fa')}`,
          },
          en: {
            title: 'Consultation offer accepted',
            body: `Consultation request status: ${tConsultation('status_offer_accepted', 'en')}`,
          },
        },
        link: `/consultations/${row.id}`,
      },
      client
    );
  }
  return true;
}
