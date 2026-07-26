export type StudentHomeSourceKind = 'idle' | 'loading' | 'ready' | 'error';
export type StudentHomeSource = 'connections' | 'plans' | 'water';

export type StudentHomeDisplayState = {
  hasCompletedInitialLoad: boolean;
  isInitialLoading: boolean;
  errorSources: StudentHomeSource[];
  canRenderPlans: boolean;
  canRenderWater: boolean;
};

/**
 * Keeps independent dashboard data sources from collapsing the whole screen.
 * The initial frame waits for every source to settle; afterwards, successful
 * sections remain usable while failed sections expose their own recovery action.
 */
export function resolveStudentHomeDisplayState(input: {
  connections: StudentHomeSourceKind;
  plans: StudentHomeSourceKind;
  water: StudentHomeSourceKind;
  hasCompletedInitialLoad?: boolean;
}): StudentHomeDisplayState {
  const entries: [StudentHomeSource, StudentHomeSourceKind][] = [
    ['connections', input.connections],
    ['plans', input.plans],
    ['water', input.water],
  ];
  const haveAllSourcesSettled = entries.every(
    ([, kind]) => kind === 'ready' || kind === 'error'
  );
  const hasCompletedInitialLoad =
    input.hasCompletedInitialLoad === true || haveAllSourcesSettled;

  return {
    hasCompletedInitialLoad,
    isInitialLoading: !hasCompletedInitialLoad,
    errorSources: entries.filter(([, kind]) => kind === 'error').map(([source]) => source),
    canRenderPlans: input.plans === 'ready',
    canRenderWater: input.water === 'ready',
  };
}
