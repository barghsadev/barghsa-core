/** Mask a destination for display (e.g. m***@example.com or +98***4567) */
export function maskDestination(destination: string): string {
  if (destination.startsWith('+')) {
    // Phone: show +98 *** 4567
    const parts = destination.match(/^(\+\d{2,3})(\d*)(\d{4})$/);
    if (parts) {
      return `${parts[1]} *** ${parts[3]}`;
    }
    return destination.replace(/.(?=.{4})/g, '*');
  }
  // Email: m***@example.com
  const parts = destination.split('@');
  if (parts.length === 2) {
    const name = parts[0]!;
    return `${name[0]!}***@${parts[1]}`;
  }
  return destination.replace(/.(?=.{4})/g, '*');
}
