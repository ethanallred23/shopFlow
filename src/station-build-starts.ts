import type {FloorCabinet} from './ActiveCabinets';

// Initial page loads, delayed history, periodic snapshots, and resumes are not new starts.
export function newStationBuilds(previous:ReadonlyMap<string,string>|null,cabinets:FloorCabinet[],onlineStations:ReadonlySet<string>,nowMs=Date.now()){
 if(!previous)return [];
 return cabinets.filter(cabinet=>{
  const started=cabinet.startedAt?Date.parse(cabinet.startedAt):NaN;
  return cabinet.stationId&&onlineStations.has(cabinet.stationId)&&cabinet.status==='building'&&!cabinet.stale&&!previous.has(cabinet.id)
   &&Number.isFinite(started)&&nowMs-started>=-5000&&nowMs-started<=30000;
 });
}
