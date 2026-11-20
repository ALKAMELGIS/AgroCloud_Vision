import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * دالة cn القياسية في نظام shadcn/ui: تدمج فئات Tailwind بدون تعارضات.
 * تُستخدم من كل مكوّنات /components/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * يستخرج رسالة خطأ نصية مقروءة من أي خطأ (axios أو غيره)،
 * حتى لا تظهر "[object Object]" للمستخدم.
 */
export function getErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  const toText = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ') || null;
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return toText(o.message) ?? toText(o.error) ?? null;
    }
    return String(v);
  };
  const e = err as any;
  return toText(e?.response?.data) ?? (e?.response ? null : toText(e?.message)) ?? fallback;
}
