import { getCategories, getFees, getProhibited } from '../api/endpoints';
import type { Category, CategoryInfo, Fees } from '../api/types';
import { useAsync } from './useAsync';

// Module-level caches: meta data is static for the lifetime of the page.
let categoriesP: Promise<CategoryInfo[]> | null = null;
let prohibitedP: Promise<string[]> | null = null;
let feesP: Promise<Fees> | null = null;

function cached<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, load: () => Promise<T>) {
  return (): Promise<T> => {
    let p = get();
    if (!p) {
      p = load().catch((e: unknown) => {
        set(null); // allow retry after failure
        throw e;
      });
      set(p);
    }
    return p;
  };
}

export const loadCategories = cached(() => categoriesP, (p) => (categoriesP = p), getCategories);
export const loadProhibited = cached(() => prohibitedP, (p) => (prohibitedP = p), getProhibited);
export const loadFees = cached(() => feesP, (p) => (feesP = p), getFees);

export const useCategories = () => useAsync(loadCategories, []);
export const useProhibited = () => useAsync(loadProhibited, []);
export const useFees = () => useAsync(loadFees, []);

export const CATEGORY_FALLBACK_LABELS: Record<Category, string> = {
  documents: 'Documents',
  purchase_for_me: 'Purchase for me',
  gifts_inspected: 'Gifts (inspected)',
  electronics_inspected: 'Electronics (inspected)',
  medicine_rx: 'Prescription medicine',
  companion_assist: 'Travel companion assist',
};

export function categoryLabel(key: Category, categories?: CategoryInfo[]): string {
  return categories?.find((c) => c.key === key)?.label ?? CATEGORY_FALLBACK_LABELS[key] ?? key;
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_FALLBACK_LABELS) as Category[];

/** Case-insensitive keyword scan mirroring the server's prohibited-item check (advisory only). */
export function findProhibited(texts: string[], prohibited: string[] | undefined): string[] {
  if (!prohibited?.length) return [];
  const haystack = texts.join(' \n ').toLowerCase();
  return prohibited.filter((p) => p && haystack.includes(p.toLowerCase()));
}
