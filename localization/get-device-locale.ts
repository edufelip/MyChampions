export function getDeviceLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === 'string' && locale.length > 0 ? locale : 'en-US';
  } catch {
    return 'en-US';
  }
}
