export function normalizeIsraeliPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.trim().replace(/[\s\-()+]/g, "");
  const normalized = digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  return /^9725\d{8}$/.test(normalized) ? normalized : null;
}
