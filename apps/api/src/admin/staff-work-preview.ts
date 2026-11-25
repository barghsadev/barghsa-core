import type { PoolClient } from 'pg';
import { activityNames } from '../common/activity-identity.js';

interface WorkRow {
  lane: 'mine' | 'urgent' | 'overdue';
  kind: 'ticket' | 'consultation';
  id: string;
  status: string;
  title_en: string | null;
  title_fa: string | null;
  created_at: Date;
  owner_id: string | null;
  team: string | null;
  overdue_hours: number | null;
}

export async function readStaffWorkPreview(
  client: PoolClient,
  userId: string,
  access: { orders: boolean; tickets: boolean; assignedTickets: boolean }
) {
  const { rows } = await client.query<WorkRow>(
    `WITH candidates AS (
       SELECT 'ticket' AS kind, t.id, t.status, t.subject AS title_en, t.subject AS title_fa,
         t.created_at, t.updated_at, t.assigned_to AS owner_id, team.name AS team,
         t.assigned_to IS NULL AND t.assigned_team_id IS NULL AND t.priority IN ('high','urgent') AS urgent,
         alert.target_hours AS overdue_hours
       FROM tickets t
       LEFT JOIN staff_teams team ON team.id=t.assigned_team_id
       LEFT JOIN LATERAL (
         SELECT target_hours FROM service_breach_alerts b
         WHERE b.item_id=t.id::text AND b.service_type IN ('ticket','workflow_ticket_' || t.priority)
           AND (b.source_activity_at=t.updated_at OR
             (b.source_activity_at IS NULL AND t.updated_at<=b.alerted_at))
           AND t.updated_at<=NOW()-make_interval(hours => b.target_hours)
         ORDER BY b.alerted_at DESC,b.service_type LIMIT 1
       ) alert ON true
       WHERE ($2::boolean OR ($3::boolean AND t.assigned_to=$1))
         AND t.status IN ('open','in_progress','waiting_staff')
         AND (t.assigned_to=$1 OR alert.target_hours IS NOT NULL OR
           (t.assigned_to IS NULL AND t.assigned_team_id IS NULL AND t.priority IN ('high','urgent')))
       UNION ALL
       SELECT 'consultation', r.id, r.status, r.product_snapshot->'title'->>'en',
         r.product_snapshot->'title'->>'fa', r.submitted_at, r.updated_at, r.staff_owner_id, r.staff_team,
         r.staff_owner_id IS NULL AND r.staff_team IS NULL AND r.submitted_at<NOW()-INTERVAL '2 days',
         alert.target_hours
       FROM consultation_requests r
       LEFT JOIN LATERAL (
         SELECT target_hours FROM service_breach_alerts b
         WHERE b.item_id=r.id::text AND b.service_type IN ('consultation','workflow_consultation')
           AND b.source_activity_at=r.updated_at
           AND r.updated_at<=NOW()-make_interval(hours => b.target_hours)
         ORDER BY b.alerted_at DESC,b.service_type LIMIT 1
       ) alert ON true
       WHERE $4::boolean AND r.status IN ('submitted','under_review','offer_accepted')
         AND (r.staff_owner_id=$1 OR alert.target_hours IS NOT NULL OR
           (r.staff_owner_id IS NULL AND r.staff_team IS NULL AND r.submitted_at<NOW()-INTERVAL '2 days'))
     )
     SELECT lanes.lane,item.*
     FROM (VALUES ('mine',1),('urgent',2),('overdue',3)) AS lanes(lane,position)
     CROSS JOIN LATERAL (
       SELECT * FROM candidates
       WHERE CASE lanes.lane
         WHEN 'mine' THEN owner_id=$1
         WHEN 'urgent' THEN urgent
         WHEN 'overdue' THEN overdue_hours IS NOT NULL
       END
       ORDER BY CASE WHEN lanes.lane='overdue' THEN updated_at+make_interval(hours => overdue_hours)
                     ELSE created_at END,id
       LIMIT 4
     ) item
     ORDER BY lanes.position,
       CASE WHEN lanes.lane='overdue' THEN item.updated_at+make_interval(hours => item.overdue_hours)
            ELSE item.created_at END,item.id`,
    [userId, access.tickets, access.assignedTickets, access.orders]
  );
  const names = await activityNames(
    client,
    rows.map((row) => row.owner_id)
  );
  const tasks = rows.map((row) => ({
    lane: row.lane,
    kind: row.kind,
    id: row.id,
    status: row.status,
    title: { en: row.title_en, fa: row.title_fa },
    createdAt: row.created_at,
    ownerName: row.owner_id ? (names.get(row.owner_id) ?? null) : null,
    team: row.team,
    assigned: row.owner_id !== null,
    mine: row.owner_id === userId,
    overdueHours: row.overdue_hours,
  }));
  return {
    tasks,
    canOpenTickets: access.tickets || access.assignedTickets,
    canOpenConsultations: access.orders,
  };
}
