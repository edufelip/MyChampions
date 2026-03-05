import Constants from 'expo-constants';

import { resolveRequiredTermsVersion, resolveTermsUrl, type TermsConfig } from './terms.logic';

type TermsExtraConfig = {
  requiredVersion?: string;
  url?: string;
};

export function resolveTermsConfigFromExpo(): TermsConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as { terms?: TermsExtraConfig };
  const terms = extra.terms ?? {};

  return {
    requiredVersion: resolveRequiredTermsVersion(terms.requiredVersion, 'v1'),
    termsUrl: resolveTermsUrl(terms.url, 'https://google.com'),
  };
}
