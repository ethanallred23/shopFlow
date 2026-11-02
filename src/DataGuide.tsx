import {Info} from 'lucide-react';

export function DataGuide({kind}:{kind:'overview'|'department'|'reports'}){
 return <details className="data-guide"><summary><Info size={17}/> How to read this data</summary><div className="data-guide-grid">
  <p><strong>Recorded output</strong> counts parts or completed cabinets reported by assigned devices in the selected date and shift. A blank measurement means data is unavailable; it does not prove that production stopped.</p>
  <p><strong>Expected now</strong> is the amount predicted by this point in scheduled working time, excluding configured breaks. <strong>Shift target</strong> is the full shift goal. They answer different questions.</p>
  <p><strong>Pace</strong> compares recorded work with the expected amount, or average cabinet build time with the desired minutes per cabinet. A red result is a prompt to investigate, not a diagnosis.</p>
  <p><strong>Connection status</strong> describes recent device contact. Offline and never connected devices can leave gaps in the measurements. Check Devices and the station timeline before comparing results.</p>
  {kind==='reports'&&<p><strong>Median cycle</strong> is the middle device-measured duration. <strong>P90 cycle</strong> is a duration that 90% of measured cycles are at or below. Both show a dash when no duration was measured.</p>}
  {kind==='department'&&<p><strong>Staffed</strong> means an account is assigned to a workstation. It does not confirm that person is physically present or working during this shift.</p>}
 </div></details>;
}
