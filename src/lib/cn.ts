import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * `clsx` handles the conditional shapes; `tailwind-merge` resolves conflicts so a
 * caller can override a default (`cn('rounded-full', 'rounded-lg')` → `rounded-lg`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
