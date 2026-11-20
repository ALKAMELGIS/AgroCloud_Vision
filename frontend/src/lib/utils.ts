import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * دالة cn القياسية في نظام shadcn/ui: تدمج فئات Tailwind بدون تعارضات.
 * تُستخدم من كل مكوّنات /components/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
