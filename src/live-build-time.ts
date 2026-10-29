export type LiveCabinet = {
  durationMs: number;
  status: string;
  stale: boolean;
  lastReportedAt: string;
};

// A short display estimate between confirmed device snapshots. The device's next
// reading replaces this value, and a missing reading stops the estimate.
export function visibleBuildMs(cabinet: LiveCabinet, nowMs: number): number {
  const confirmed = Math.max(0, cabinet.durationMs);
  if (cabinet.status !== 'building' || cabinet.stale) return confirmed;
  const reported = Date.parse(cabinet.lastReportedAt);
  if (!Number.isFinite(reported)) return confirmed;
  return confirmed + Math.min(30000, Math.max(0, nowMs - reported));
}

export function visibleCurrentBuildMs(cabinets: LiveCabinet[], nowMs: number): number {
  return cabinets.filter(c => c.status === 'building' || c.status === 'paused')
    .reduce((sum, cabinet) => sum + visibleBuildMs(cabinet, nowMs), 0);
}
