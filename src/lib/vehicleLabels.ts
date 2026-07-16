export function registrationLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^Motrex\s*-\s*/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function registrationKey(value: string | null | undefined): string {
  return registrationLabel(value).toUpperCase();
}

export function shouldUseRegistrationLabel(columnName: string): boolean {
  return /vehicle|registration|reg\s*no|plate|unit|group/i.test(columnName);
}
