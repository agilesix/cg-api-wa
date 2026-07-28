import { z } from 'zod';

const nullableString = z.string().nullable().optional();

export const WaApplicationLinkSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().optional(),
    target: z.string().optional(),
  })
  .passthrough();

/**
 * Advanced Custom Fields exposed by FundHubWA. The object is passthrough on
 * purpose: snapshots retain newly added source fields even before the adapter
 * learns how to promote them into CommonGrants.
 */
export const WaAcfSchema = z
  .object({
    funding_status: z.string(),
    featured_funding: z.boolean(),
    internal_reference_id: z.string(),
    external_reference_id: z.string(),
    application_open_date: nullableString,
    application_close_date: nullableString,
    application_close_time: nullableString,
    expiry_date: nullableString,
    period_of_performance_start: nullableString,
    period_of_performance_end: nullableString,
    fund_published_date: nullableString,
    open_date: nullableString,
    federal_or_state: z.string(),
    source: z.string(),
    total_amount: z.string(),
    number_of_awards: z.string(),
    award_start: z.string(),
    ending_amount: z.string(),
    disbursement_notes: z.string(),
    cost_share: z.string(),
    description: z.string(),
    pre_application: z.string(),
    eligibility: z.string(),
    requirements: z.string(),
    application_link: z.union([WaApplicationLinkSchema, z.string()]),
    contact: z.string(),
    technical_assistance_contact: z.string(),
    resources: z.string(),
    score: z.number(),
    score_reason: z.string(),
  })
  .passthrough();

export const WaTermSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    slug: z.string(),
    taxonomy: z.string(),
  })
  .passthrough();

/**
 * A FundHubWA WordPress `funding` record. We request `_embed=wp:term` so the
 * adapter receives taxonomy labels instead of opaque numeric term ids.
 */
export const WaGrantSchema = z
  .object({
    id: z.number().int(),
    date_gmt: z.string(),
    modified_gmt: z.string(),
    slug: z.string(),
    link: z.string(),
    title: z.object({ rendered: z.string() }).passthrough(),
    acf: WaAcfSchema,
    'funding-type': z.array(z.number().int()).optional(),
    'funding-audience': z.array(z.number().int()).optional(),
    'funding-sector': z.array(z.number().int()).optional(),
    'funding-disbursement-method': z.array(z.number().int()).optional(),
    'funding-activity': z.array(z.number().int()).optional(),
    'funding-location': z.array(z.number().int()).optional(),
    _embedded: z
      .object({
        'wp:term': z.array(z.array(WaTermSchema)).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type WaGrant = z.infer<typeof WaGrantSchema>;
export type WaTerm = z.infer<typeof WaTermSchema>;

export const WordPressFundingPageSchema = z.array(WaGrantSchema);
export type WordPressFundingPage = z.infer<typeof WordPressFundingPageSchema>;
