import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../types';
import { addresses } from './addresses';
import { documents } from './documents';
import { profiles } from './profiles';
import { users } from './users';

export const solarConstructionRequests = pgTable(
  'solar_construction_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    submissionKey: uuid('submission_key').notNull(),
    status: text('status').notNull().default('submitted'),
    buildingType: text('building_type').notNull(),
    gridType: text('grid_type').notNull(),
    billIdentifier: varchar('bill_identifier', { length: 13 }),
    propertyForm: text('property_form'),
    structuralFrame: text('structural_frame'),
    buildingCompletionDate: date('building_completion_date'),
    totalUnits: integer('total_units'),
    siteCategory: text('site_category'),
    installationSurface: text('installation_surface'),
    usableAreaSqm: numeric('usable_area_sqm', { precision: 12, scale: 2 }),
    siteAddressId: uuid('site_address_id').references(() => addresses.id, { onDelete: 'restrict' }),
    siteRelationship: text('site_relationship'),
    siteDescription: text('site_description'),
    agreementAccepted: boolean('agreement_accepted').notNull().default(false),
    agreementVersion: text('agreement_version').notNull(),
    agreementSnapshot: text('agreement_snapshot').notNull(),
    agreementAcceptedAt: timestamp('agreement_accepted_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    statusReason: text('status_reason'),
    supportPath: text('support_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('solar_requests_profile_idx').on(t.profileId, t.createdAt, t.id),
    index('solar_requests_status_idx').on(t.status, t.createdAt, t.id),
    uniqueIndex('solar_requests_submission_key').on(t.submittedBy, t.submissionKey),
    check(
      'solar_requests_building_type',
      sql`${t.buildingType} IN ('building_apartment','non_household')`
    ),
    check('solar_requests_grid_type', sql`${t.gridType} IN ('on_grid','off_grid')`),
    check(
      'solar_requests_bill',
      sql`(${t.gridType}='off_grid' AND ${t.billIdentifier} IS NULL) OR (${t.gridType}='on_grid' AND ${t.billIdentifier} IS NOT NULL AND ${t.billIdentifier} ~ '^[0-9]{6,13}$')`
    ),
    check(
      'solar_requests_property_form',
      sql`${t.propertyForm} IS NULL OR ${t.propertyForm} IN ('apartment','villa')`
    ),
    check(
      'solar_requests_frame',
      sql`${t.structuralFrame} IS NULL OR ${t.structuralFrame} IN ('concrete','steel','other')`
    ),
    check(
      'solar_requests_site_category',
      sql`${t.siteCategory} IS NULL OR ${t.siteCategory} IN ('agricultural','industrial')`
    ),
    check(
      'solar_requests_surface',
      sql`${t.installationSurface} IS NULL OR ${t.installationSurface} IN ('land','rooftop','both')`
    ),
    check(
      'solar_requests_relationship',
      sql`${t.siteRelationship} IS NULL OR ${t.siteRelationship} IN ('owner','tenant','authorized_operator')`
    ),
    check('solar_requests_units', sql`${t.totalUnits} IS NULL OR ${t.totalUnits}>0`),
    check('solar_requests_area', sql`${t.usableAreaSqm} IS NULL OR ${t.usableAreaSqm}>0`),
    check(
      'solar_requests_agreement',
      sql`${t.agreementAccepted} AND length(trim(${t.agreementVersion}))>0 AND length(trim(${t.agreementSnapshot}))>0`
    ),
    check(
      'solar_requests_building_fields',
      sql`(${t.buildingType}='building_apartment' AND ${t.propertyForm} IS NOT NULL AND ${t.structuralFrame} IS NOT NULL AND ${t.buildingCompletionDate} IS NOT NULL AND ((${t.propertyForm}='villa' AND ${t.totalUnits} IS NULL) OR (${t.propertyForm}='apartment' AND coalesce(${t.totalUnits},0)>0)) AND ${t.siteCategory} IS NULL AND ${t.installationSurface} IS NULL AND ${t.usableAreaSqm} IS NULL AND ${t.siteAddressId} IS NULL AND ${t.siteRelationship} IS NULL AND ${t.siteDescription} IS NULL) OR (${t.buildingType}='non_household' AND ${t.propertyForm} IS NULL AND ${t.structuralFrame} IS NULL AND ${t.buildingCompletionDate} IS NULL AND ${t.totalUnits} IS NULL AND ${t.siteCategory} IS NOT NULL AND ${t.installationSurface} IS NOT NULL AND coalesce(${t.usableAreaSqm},0)>0 AND ${t.siteAddressId} IS NOT NULL AND ${t.siteRelationship} IS NOT NULL)`
    ),
    check(
      'solar_requests_status',
      sql`${t.status} IN ('draft','submitted','uploading_documents','documents_under_review','changes_requested','waiting_for_postal_submission','postal_documents_received','final_review','approved','rejected','cancelled','contract_created')`
    ),
    check(
      'solar_requests_decision_reason',
      sql`${t.status} NOT IN ('rejected','cancelled') OR (coalesce(length(trim(${t.statusReason})),0)>0 AND coalesce(length(trim(${t.supportPath})),0)>0)`
    ),
  ]
);

export const solarConstructionDocuments = pgTable(
  'solar_construction_documents',
  {
    id: uuidv7('id').primaryKey().notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => solarConstructionRequests.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    staffStatus: text('staff_status').notNull().default('pending'),
    staffReason: text('staff_reason'),
    staffReviewedBy: text('staff_reviewed_by').references(() => users.userId, {
      onDelete: 'restrict',
    }),
    staffReviewedAt: timestamp('staff_reviewed_at', { withTimezone: true }),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('solar_documents_document_key').on(t.documentId),
    index('solar_documents_request_idx').on(t.requestId, t.uploadedAt, t.id),
    check(
      'solar_documents_staff_status',
      sql`${t.staffStatus} IN ('pending','approved','rejected')`
    ),
    check(
      'solar_documents_review',
      sql`(${t.staffStatus}='pending' AND ${t.staffReviewedBy} IS NULL AND ${t.staffReviewedAt} IS NULL) OR (${t.staffStatus}<>'pending' AND ${t.staffReviewedBy} IS NOT NULL AND ${t.staffReviewedAt} IS NOT NULL)`
    ),
    check(
      'solar_documents_rejection_reason',
      sql`${t.staffStatus}<>'rejected' OR coalesce(length(trim(${t.staffReason})),0)>0`
    ),
  ]
);

export const solarConstructionPostal = pgTable(
  'solar_construction_postal',
  {
    id: uuidv7('id').primaryKey().notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => solarConstructionRequests.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('waiting_for_shipment'),
    courier: text('courier'),
    trackingNumber: text('tracking_number'),
    sendDate: timestamp('send_date', { withTimezone: true }),
    receiptImageId: uuid('receipt_image_id').references(() => documents.id, {
      onDelete: 'restrict',
    }),
    staffConfirmedBy: text('staff_confirmed_by').references(() => users.userId, {
      onDelete: 'restrict',
    }),
    staffConfirmedAt: timestamp('staff_confirmed_at', { withTimezone: true }),
    staffNotes: text('staff_notes'),
  },
  (t) => [
    uniqueIndex('solar_postal_request_key').on(t.requestId),
    check(
      'solar_postal_status',
      sql`${t.status} IN ('waiting_for_shipment','shipped','received','incomplete','not_received')`
    ),
  ]
);

export const solarDocumentRequests = pgTable(
  'solar_document_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => solarConstructionRequests.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('solar_document_requests_request_idx').on(t.requestId, t.createdAt, t.id),
    check(
      'solar_document_requests_description',
      sql`length(trim(${t.description})) BETWEEN 1 AND 2000`
    ),
  ]
);
