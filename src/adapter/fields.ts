import { z } from 'zod';

// Shared field shapes are intentionally identical to the grants.gov, PA, and
// CA plugins until the ecosystem publishes a shared-fields package.
export const AgencyValueSchema = z.object({
  code: z.string().nullish(),
  name: z.string().nullish(),
  parentName: z.string().nullish(),
  parentCode: z.string().nullish(),
});

export const ContactInfoValueSchema = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  description: z.string().nullish(),
});

export const AdditionalInfoValueSchema = z.object({
  url: z.string().nullish(),
  description: z.string().nullish(),
});

export const CostSharingValueSchema = z.object({
  isRequired: z.boolean().nullish(),
  percentage: z.number().nullish(),
  details: z.string().nullish(),
});

export const WaStringListSchema = z.array(z.string());
export const WaTaxonomiesValueSchema = z.record(WaStringListSchema);
