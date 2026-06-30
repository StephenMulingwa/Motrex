export function registrationLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^Motrex\s*-\s*/i, "")
    .trim();
}

export function shouldUseRegistrationLabel(columnName: string): boolean {
  return /vehicle|registration|reg\s*no|plate|unit|group/i.test(columnName);
}
