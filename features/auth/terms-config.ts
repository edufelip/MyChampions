import Constants from 'expo-constants';

import {
  DEFAULT_PRIVACY_POLICY_URL,
  DEFAULT_TERMS_URL,
  resolvePrivacyPolicyUrl,
  resolveRequiredTermsVersion,
  resolveTermsUrl,
  type TermsConfig,
} from './terms.logic';

type TermsExtraConfig = {
  requiredVersion?: string;
  url?: string;
  privacyPolicyUrl?: string;
};

export function resolveTermsConfigFromExpo(): TermsConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as { terms?: TermsExtraConfig };
  const terms = extra.terms ?? {};

  return {
    requiredVersion: resolveRequiredTermsVersion(terms.requiredVersion, 'v1'),
    termsUrl: resolveTermsUrl(terms.url, DEFAULT_TERMS_URL),
    privacyPolicyUrl: resolvePrivacyPolicyUrl(terms.privacyPolicyUrl, DEFAULT_PRIVACY_POLICY_URL),
  };
}
