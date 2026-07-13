export type PlansAuthUidResolverDeps = {
  getServerUserUid: () => string | null;
  getE2EUid: () => string | null;
};

export function resolvePlansAuthUid(deps: PlansAuthUidResolverDeps): string | null {
  const serverUid = deps.getServerUserUid();
  if (serverUid) return serverUid;

  return deps.getE2EUid();
}
