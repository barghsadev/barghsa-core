import { z } from 'zod';

const base = z.object({
  profileId: z.string().uuid(),
  submissionKey: z.string().uuid(),
  gridType: z.enum(['on_grid', 'off_grid']),
  billIdentifier: z
    .string()
    .regex(/^[0-9]{6,13}$/)
    .optional(),
  agreementAccepted: z.literal(true),
});

export const solarSubmission = z
  .discriminatedUnion('buildingType', [
    base
      .extend({
        buildingType: z.literal('building_apartment'),
        propertyForm: z.enum(['apartment', 'villa']),
        structuralFrame: z.enum(['concrete', 'steel', 'other']),
        buildingCompletionDate: z.iso.date(),
        totalUnits: z.number().int().min(1).max(100000).optional(),
      })
      .strict(),
    base
      .extend({
        buildingType: z.literal('non_household'),
        siteCategory: z.enum(['agricultural', 'industrial']),
        installationSurface: z.enum(['land', 'rooftop', 'both']),
        usableAreaSqm: z.number().positive().max(1_000_000),
        siteAddressId: z.string().uuid(),
        siteRelationship: z.enum(['owner', 'tenant', 'authorized_operator']),
        siteDescription: z.string().trim().max(2000).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.gridType === 'on_grid' && !value.billIdentifier)
      ctx.addIssue({
        code: 'custom',
        path: ['billIdentifier'],
        message: 'Bill identifier is required',
      });
    if (value.gridType === 'off_grid' && value.billIdentifier)
      ctx.addIssue({
        code: 'custom',
        path: ['billIdentifier'],
        message: 'Bill identifier is only for on-grid requests',
      });
    if (value.buildingType === 'building_apartment') {
      if (value.propertyForm === 'apartment' && !value.totalUnits)
        ctx.addIssue({ code: 'custom', path: ['totalUnits'], message: 'Unit count is required' });
      if (value.propertyForm === 'villa' && value.totalUnits !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['totalUnits'],
          message: 'Unit count is only for apartments',
        });
      if (value.buildingCompletionDate > new Date().toISOString().slice(0, 10))
        ctx.addIssue({
          code: 'custom',
          path: ['buildingCompletionDate'],
          message: 'Completion date cannot be in the future',
        });
    }
  });

export type SolarSubmission = z.infer<typeof solarSubmission>;

/** Incomplete form values are valid here; submission still uses solarSubmission. */
export const solarDraftData = z
  .object({
    buildingType: z.enum(['building_apartment', 'non_household']),
    propertyForm: z.enum(['apartment', 'villa']),
    structuralFrame: z.enum(['concrete', 'steel', 'other']),
    buildingCompletionDate: z.string().max(10),
    totalUnits: z.string().max(6),
    siteCategory: z.enum(['agricultural', 'industrial']),
    installationSurface: z.enum(['land', 'rooftop', 'both']),
    usableAreaSqm: z.string().max(20),
    siteAddressId: z.string().max(36),
    siteRelationship: z.enum(['owner', 'tenant', 'authorized_operator']),
    siteDescription: z.string().max(2000),
    gridType: z.enum(['on_grid', 'off_grid']),
    billIdentifier: z.string().max(13),
  })
  .strict();

export const solarDraftInput = z
  .object({
    profileId: z.string().uuid(),
    currentStep: z.literal(1),
    data: solarDraftData,
  })
  .strict();
export type SolarDraftInput = z.infer<typeof solarDraftInput>;
