export type CabinetSample = {
  id: bigint; deviceId: string; bootId: string; uptimeMs: bigint;
  occurredAt: Date | null; receivedAt: Date; data: any;
};
export type CabinetRecord = {
  id: string; number: number; deviceId: string; startedAt: string | null; finishedAt: string | null;
  durationMs: number; status: 'building' | 'paused' | 'completed' | 'interrupted';
  lastReportedAt: string; stale: boolean;
};

// Samples must be accepted measurements in ingestion order. Repeated snapshots update
// the same cabinet; device uptime supplies duration even across clock changes/reset commands.
export function cabinetRecords(rows: CabinetSample[], start: Date, end: Date, now = new Date()) {
  const records = new Map<string, CabinetRecord>();
  const current = new Map<string, string>();
  const legacy = new Map<string, {key: string; boot: string; counter: string; total: number}>();
  const lastSeen = new Map<string, number>();
  const time = (row: CabinetSample, uptime: number) => {
    if (!row.occurredAt) return null;
    const date = new Date(row.occurredAt.getTime() - (Number(row.uptimeMs) - uptime));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  for (const row of rows) {
    const data = row.data, c = data.cabinet;
    let key: string | undefined;
    if (c) {
      key = `${row.deviceId}:${row.bootId}:${c.id}`;
      const old = records.get(key);
      // A completed cabinet stays completed, including repeated idle snapshots.
      if (old?.status === 'completed') {
        old.startedAt ??= time(row, c.startedUptimeMs);
        if (c.finishedUptimeMs !== null) old.finishedAt ??= time(row, c.finishedUptimeMs);
        lastSeen.set(key, (row.occurredAt ?? row.receivedAt).getTime());
        continue;
      }
      records.set(key, {
        id: key, number: 0, deviceId: row.deviceId,
        startedAt: old?.startedAt ?? time(row, c.startedUptimeMs),
        finishedAt: c.finishedUptimeMs === null ? null : time(row, c.finishedUptimeMs),
        durationMs: c.elapsedMs,
        status: c.finishedUptimeMs !== null ? 'completed' : c.running ? 'building' : 'paused',
        lastReportedAt: (row.occurredAt ?? row.receivedAt).toISOString(),
        stale: !row.occurredAt || now.getTime()-row.occurredAt.getTime()>30000 || now.getTime()-row.receivedAt.getTime()>30000,
      });
    } else {
      // Preserve historical firmware records without inventing completion on reboot.
      let prior = legacy.get(row.deviceId);
      if (prior?.boot !== row.bootId) prior = undefined;
      if (prior) {
        const record = records.get(prior.key)!;
        const total = Number(data.totalDetectedMs);
        record.durationMs += Math.max(0, prior.counter === data.counterId ? total-prior.total : total-(data.calibration?.offsetMs??0));
        prior.total = total; prior.counter = data.counterId;
        record.lastReportedAt = (row.occurredAt ?? row.receivedAt).toISOString();
        record.stale = !row.occurredAt || now.getTime()-row.occurredAt.getTime()>30000 || now.getTime()-row.receivedAt.getTime()>30000;
        key = prior.key;
        if (!data.detected) {
          record.status = 'completed'; record.finishedAt = row.occurredAt?.toISOString() ?? null;
          legacy.delete(row.deviceId);
        }
      } else if (data.detected) {
        key = `${row.deviceId}:${row.bootId}:legacy-${row.id}`;
        records.set(key, {id:key,number:0,deviceId:row.deviceId,startedAt:row.occurredAt?.toISOString()??null,finishedAt:null,durationMs:0,status:'building',lastReportedAt:(row.occurredAt??row.receivedAt).toISOString(),stale:true});
        legacy.set(row.deviceId, {key,boot:row.bootId,counter:data.counterId,total:Number(data.totalDetectedMs)});
      }
    }
    const previousKey = current.get(row.deviceId);
    if (previousKey && previousKey !== key) {
      const previous = records.get(previousKey)!;
      if (previous.status !== 'completed') previous.status = 'interrupted';
    }
    if (key) { current.set(row.deviceId, key); lastSeen.set(key, (row.occurredAt??row.receivedAt).getTime()); }
    else current.delete(row.deviceId);
  }
  return [...records.values()].filter(r => {
    const begin = r.startedAt ? Date.parse(r.startedAt) : lastSeen.get(r.id)!;
    const finish = r.finishedAt ? Date.parse(r.finishedAt) : lastSeen.get(r.id)!;
    return begin < end.getTime() && finish >= start.getTime();
  }).sort((a,b)=>(Date.parse(a.startedAt??a.lastReportedAt)-Date.parse(b.startedAt??b.lastReportedAt)) || a.id.localeCompare(b.id))
    .map((r,i)=>({...r,number:i+1}));
}
