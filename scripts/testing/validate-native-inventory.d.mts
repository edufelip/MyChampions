export function validateNativeInventory(
  value: unknown,
  repositoryRoot: string,
): Promise<{
  byPlatform: Record<
    string,
    {
      views: { captured: string[]; denominator: string[] };
      transitions: { captured: string[]; denominator: string[] };
      behavior: { passing: string[]; denominator: string[] };
    }
  >;
  views: { captured: string[]; denominator: string[] };
  transitions: { captured: string[]; denominator: string[] };
  behavior: { passing: string[]; readyDenominator: string[]; coverage: string };
  disposition: { passing: number; denominator: number; untested: number };
}>;
