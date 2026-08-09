export function resolveLatestSyncTimestamp(
  timestamps: Array<string | null | undefined>,
): string | null {
  let latest: { iso: string; time: number } | null = null;

  for (const timestamp of timestamps) {
    if (!timestamp) continue;

    const time = Date.parse(timestamp);
    if (Number.isNaN(time)) continue;

    if (!latest || time > latest.time) {
      latest = { iso: timestamp, time };
    }
  }

  return latest?.iso ?? null;
}
