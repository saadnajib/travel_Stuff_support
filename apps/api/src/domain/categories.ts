export type Category =
  | 'documents'
  | 'purchase_for_me'
  | 'gifts_inspected'
  | 'electronics_inspected'
  | 'medicine_rx'
  | 'companion_assist';

export interface CategoryRule {
  key: Category;
  label: string;
  description: string;
  requiresInspection: boolean;
  requiresPrescription: boolean;
  maxValueMinor: number;
  maxWeightKg: number;
}

export const CATEGORIES: CategoryRule[] = [
  {
    key: 'documents',
    label: 'Documents',
    description: 'Paperwork, certificates, letters. Envelopes must be open for inspection at handover.',
    requiresInspection: true,
    requiresPrescription: false,
    maxValueMinor: 20_000,
    maxWeightKg: 2,
  },
  {
    key: 'purchase_for_me',
    label: 'Buy for me',
    description: 'The traveller buys a specific product from a retailer and brings it. The traveller always knows exactly what they carry.',
    requiresInspection: true,
    requiresPrescription: false,
    maxValueMinor: 50_000,
    maxWeightKg: 10,
  },
  {
    key: 'gifts_inspected',
    label: 'Gifts (inspected)',
    description: 'Clothing, toys, non-perishable sweets. Unwrapped and inspected item by item at handover.',
    requiresInspection: true,
    requiresPrescription: false,
    maxValueMinor: 30_000,
    maxWeightKg: 8,
  },
  {
    key: 'electronics_inspected',
    label: 'Electronics (inspected)',
    description: 'Phones, laptops, accessories. Powered on and inspected at handover; batteries in hand luggage only.',
    requiresInspection: true,
    requiresPrescription: false,
    maxValueMinor: 50_000,
    maxWeightKg: 5,
  },
  {
    key: 'medicine_rx',
    label: 'Prescription medicine',
    description: 'Only with a valid prescription in the recipient’s name and original pharmacy packaging. Controlled substances are not allowed.',
    requiresInspection: true,
    requiresPrescription: true,
    maxValueMinor: 30_000,
    maxWeightKg: 2,
  },
  {
    key: 'companion_assist',
    label: 'Travel companion / assistance',
    description: 'Accompany an elderly or first-time traveller on the same flight, help at the airport. No goods are carried.',
    requiresInspection: false,
    requiresPrescription: false,
    maxValueMinor: 0,
    maxWeightKg: 0,
  },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [Category, ...Category[]];

export function categoryRule(key: Category): CategoryRule {
  const rule = CATEGORIES.find((c) => c.key === key);
  if (!rule) throw new Error(`Unknown category ${key}`);
  return rule;
}

export const REQUIRED_ATTESTATIONS = ['items_unsealed', 'no_prohibited', 'truthful_declaration', 'accept_inspection'] as const;
export const PRESCRIPTION_ATTESTATION = 'has_prescription';

export const FEES = {
  platformFeePct: 15,
  protectionFeeMinor: 100,
  minRewardMinor: 500,
  maxRewardMinor: 100_000,
  maxTripCapacityKg: 30,
} as const;

export function computeFees(rewardMinor: number): { platformFeeMinor: number; protectionFeeMinor: number; totalChargeMinor: number } {
  const platformFeeMinor = Math.round((rewardMinor * FEES.platformFeePct) / 100);
  const protectionFeeMinor = FEES.protectionFeeMinor;
  return { platformFeeMinor, protectionFeeMinor, totalChargeMinor: rewardMinor + platformFeeMinor + protectionFeeMinor };
}

/** Lower-case keyword list. Deliberately broad; matches are reviewed as a blocked posting, not a ban. */
export const PROHIBITED_KEYWORDS: string[] = [
  'cash', 'currency', 'banknote', 'gold bar', 'bullion', 'jewellery', 'jewelry', 'diamond',
  'weapon', 'gun', 'firearm', 'ammunition', 'ammo', 'knife', 'blade', 'taser', 'pepper spray',
  'explosive', 'firework', 'fireworks', 'lighter fluid', 'fuel', 'gas cylinder', 'aerosol',
  'drug', 'drugs', 'narcotic', 'cannabis', 'weed', 'marijuana', 'hash', 'cocaine', 'heroin', 'opium', 'meth',
  'ecstasy', 'mdma', 'lsd', 'ketamine', 'steroid', 'steroids', 'tramadol', 'codeine', 'xanax', 'valium', 'diazepam',
  'oxycodone', 'morphine', 'fentanyl',
  'sealed package', 'sealed parcel', 'do not open', "don't open", 'dont open', 'unopened box', 'no questions asked',
  'alcohol', 'liquor', 'whisky', 'whiskey', 'vodka', 'wine', 'beer',
  'tobacco', 'cigarette', 'cigarettes', 'cigar', 'vape', 'e-cigarette', 'shisha', 'nicotine',
  'meat', 'fresh food', 'perishable', 'seeds', 'plant', 'plants', 'soil', 'animal', 'pet', 'ivory', 'coral',
  'lithium battery pack', 'power bank', 'counterfeit', 'fake', 'replica', 'pirated',
  'passport', 'sim card', 'sim cards', 'bank card', 'credit card', 'debit card',
  'pornograph', 'adult content', 'blood sample', 'blood samples', 'human organ', 'human tissue', 'chemical', 'acid', 'mercury', 'poison',
];

export function findProhibited(texts: string[]): string[] {
  const haystack = texts.join(' \n ').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ');
  const padded = ` ${haystack.replace(/\s+/g, ' ')} `;
  const matched = new Set<string>();
  for (const kw of PROHIBITED_KEYWORDS) {
    if (padded.includes(` ${kw} `) || padded.includes(` ${kw}s `)) matched.add(kw);
  }
  return [...matched];
}
