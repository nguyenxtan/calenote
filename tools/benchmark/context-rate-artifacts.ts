/** The record ceiling is a byte limit, never an invitation to trim evidence. */
export function boundedRateRecord(value:unknown):string{const text=typeof value==='string'?value:JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>16384)throw Error('RATE_RECORD_SIZE');return text;}
export interface RateEvidenceEntry{file:string;sha256:string;bytes:number}
export function rateEvidenceChunks(entries:RateEvidenceEntry[]){
 const result:Array<{version:'rate-evidence-index-2';entries:RateEvidenceEntry[]}>=[];let current:RateEvidenceEntry[]=[];
 for(const entry of entries){boundedRateRecord({version:'rate-evidence-index-2',entries:[entry]});const candidate={version:'rate-evidence-index-2' as const,entries:[...current,entry]};
  if(Buffer.byteLength(JSON.stringify(candidate))>16384){result.push({version:'rate-evidence-index-2',entries:current});current=[entry];}else current=candidate.entries;
 }
 if(current.length)result.push({version:'rate-evidence-index-2',entries:current});return result;
}
