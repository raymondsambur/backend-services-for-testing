/**
 * Mask sensitive data by replacing all characters except the last 4 with asterisks.
 * If the input has 4 or fewer characters, all characters are masked.
 */
export function maskSensitiveData(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  const visiblePart = value.slice(-4);
  const maskedPart = '*'.repeat(value.length - 4);
  return maskedPart + visiblePart;
}
