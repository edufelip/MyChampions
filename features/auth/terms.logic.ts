export type TermsConfig = {
  requiredVersion: string;
  termsUrl: string;
};

export type TermsStateInput = {
  requiredVersion: string;
  acceptedVersion: string | null;
};

export function normalizeTermsVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function resolveRequiredTermsVersion(value: string | null | undefined, fallback = 'v1'): string {
  return normalizeTermsVersion(value) ?? fallback;
}

export function resolveTermsUrl(value: string | null | undefined, fallback = 'https://google.com'): string {
  if (!value) return fallback;
  const next = value.trim();
  return next.length > 0 ? next : fallback;
}

export function needsTermsAcceptance(input: TermsStateInput): boolean {
  const required = normalizeTermsVersion(input.requiredVersion);
  const accepted = normalizeTermsVersion(input.acceptedVersion);

  if (!required) return false;
  return accepted !== required;
}
