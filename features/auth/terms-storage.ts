import AsyncStorage from '@react-native-async-storage/async-storage';

function acceptedTermsKey(authUid: string): string {
  return `auth.terms.accepted_version.${authUid}`;
}

export async function getAcceptedTermsVersion(authUid: string): Promise<string | null> {
  return AsyncStorage.getItem(acceptedTermsKey(authUid));
}

export async function setAcceptedTermsVersion(authUid: string, version: string): Promise<void> {
  await AsyncStorage.setItem(acceptedTermsKey(authUid), version);
}
