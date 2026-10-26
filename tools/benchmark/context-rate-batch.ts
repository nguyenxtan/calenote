import {CURRENT_RATE_SCOPE,createCurrentRateBudget} from './context-rate-current-policy';
/** Durable scheduling/accounting controller only; it owns no provider transport,
 * credential callback or paid authority. The reviewed launch bridge supplies
 * fresh trusted account/source checks while holding the physical account lock. */
import {createHash} from 'node:crypto';
import {readFileSync,openSync,writeSync,closeSync,fsyncSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {RATE_POLICY as P,checkRateClock,planRateCooldown,ratePacingDelay,rateNatural,rateSum,type RateHint,type RateClock} from './context-rate-policy';
type Row={sequence:number;previousHash:string;hash:string;event:string;wall:number;mono:number;run:number;id?:string;eligible?:boolean;reason?:string};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function syncDir(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function writeExclusive(path:string,value:unknown){const text=JSON.stringify(value);const fd=openSync(path,'wx',0o600);try{if(writeSync(fd,text)!==Buffer.byteLength(text))throw Error('RATE_PERSISTENCE');fsyncSync(fd);}finally{closeSync(fd);}}
export function readRateBatchJournal(directory:string):Row[]{
 if(realpathSync(directory)!==directory||lstatSync(directory).isSymbolicLink())throw Error('RATE_PATH');
 const path=join(directory,'journal.jsonl');if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>1048576)throw Error('RATE_JOURNAL');
 const body=readFileSync(path,'utf8');if(!body.endsWith('\n'))throw Error('RATE_JOURNAL');
 const rows=body.trim().split('\n').map(v=>JSON.parse(v) as Row);let prior='0'.repeat(64);
 for(const [index,{hash:actual,...r}] of rows.entries()){if(r.sequence!==index+1||r.previousHash!==prior||hash(JSON.stringify(r))!==actual)throw Error('RATE_JOURNAL');prior=actual;}
 return rows;
}
export interface RateBatchBudget{baseline:number;unknown:number;subcap:number;runs:number;batchMs:number;phaseEnvelope:boolean}
export interface RateBatchOptions{budget?:Readonly<RateBatchBudget>;accountRoot:string;directory:string;recordDigest:string;clock:()=>RateClock;wait:(ms:number,signal:AbortSignal)=>Promise<void>;jitter:()=>number;verify:()=>{retained:number;unknown:number};signal:AbortSignal}
export class RateBatchController{
 private readonly budget:Readonly<RateBatchBudget>;private readonly origin:RateClock;private last:RateClock;private readonly expiry:RateClock;private rows:Row[]=[];private run=0;private requests=0;private total=0;private start?:RateClock;private previousStart:number|null=null;private inflight?:{id:string;dispatched:boolean};private closed=false;private busy=false;
 constructor(private readonly options:RateBatchOptions){
  const {accountRoot:root,directory,recordDigest}=options;
  if(realpathSync(root)!==root||!isAbsolute(directory)||relative(root,directory).startsWith('..')||join(root,relative(root,directory))!==directory||relative(root,directory).includes('/')||!/^[a-f0-9]{64}$/u.test(recordDigest))throw Error('RATE_PATH');
  if(options.budget){const expected=createCurrentRateBudget({baseline:options.budget.baseline,unknown:options.budget.unknown});if(Object.keys(options.budget).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>options.budget![k as keyof RateBatchBudget]!==v))throw Error('RATE_CURRENT_SCOPE');this.budget=expected;}else this.budget=Object.freeze({baseline:P.baseline,unknown:P.unknown,subcap:P.subcap,runs:P.runs,batchMs:P.batchMs,phaseEnvelope:false});
  const c=options.clock();this.origin=checkRateClock(c,c,c);this.last=this.origin;this.expiry={wall:rateSum(c.wall,this.budget.batchMs),mono:rateSum(c.mono,this.budget.batchMs)};
  // mkdir is the atomic, never-repaired batch claim. An interrupted controller
  // cannot reopen it even if the process/account lock later disappears.
  mkdirSync(directory,{mode:0o700});syncDir(root);writeExclusive(join(directory,'controller.claim'),{recordDigest,pid:process.pid,origin:c,...(options.budget?{budget:this.budget}:{})});syncDir(directory);
  const fd=openSync(join(directory,'journal.jsonl'),'wx',0o600);fsyncSync(fd);closeSync(fd);syncDir(directory);
  this.append('BEGIN',c);
 }
 private sample(){const n=checkRateClock(this.origin,this.last,this.options.clock());this.last=n;return n;}
 private tick(){const n=this.sample();if(n.wall>=this.expiry.wall||n.mono>=this.expiry.mono)throw Error('RATE_BATCH_EXPIRY');return n;}
 private append(event:string,c:RateClock,id?:string,eligible?:boolean,reason?:string){
  const row={sequence:this.rows.length+1,previousHash:this.rows.at(-1)?.hash??'0'.repeat(64),event,wall:c.wall,mono:c.mono,run:this.run,...(id?{id}:{}),...(eligible!==undefined?{eligible}:{}),...(reason?{reason}:{})};
  const stored={...row,hash:hash(JSON.stringify(row))},text=JSON.stringify(stored)+'\n',fd=openSync(join(this.options.directory,'journal.jsonl'),'a');
  try{if(writeSync(fd,text)!==Buffer.byteLength(text))throw Error('RATE_PERSISTENCE');fsyncSync(fd);}catch(e){this.closed=true;throw e;}finally{closeSync(fd);}
  this.rows.push(stored);
 }
 remainingMilliseconds(){const n=this.sample();if(!this.start)throw Error('RATE_RUN_REQUIRED');return Math.max(0,Math.min(P.runMs-(n.wall-this.start.wall),P.runMs-(n.mono-this.start.mono),this.expiry.wall-n.wall,this.expiry.mono-n.mono));}
 private checkRun(n:RateClock){if(!this.start||n.wall-this.start.wall>=P.runMs||n.mono-this.start.mono>=P.runMs)throw Error('RATE_RUN_EXPIRY');}
 canCredit(){const n=this.sample();return !this.closed&&!this.options.signal.aborted&&!!this.start&&n.wall-this.start.wall<P.runMs&&n.mono-this.start.mono<P.runMs&&n.wall<this.expiry.wall&&n.mono<this.expiry.mono;}
 private verify(){
  const disk=readRateBatchJournal(this.options.directory);if(JSON.stringify(disk)!==JSON.stringify(this.rows))throw Error('RATE_JOURNAL_DRIFT');
  const b=this.options.verify();if(!rateNatural(b.retained)||!rateNatural(b.unknown)||b.retained<this.budget.baseline||b.unknown<this.budget.unknown)throw Error('RATE_BASELINE');
  const prospective=rateSum(b.retained,P.reserve);if(prospective>P.cap)throw Error('RATE_GLOBAL_CAP');if(this.budget.phaseEnvelope&&prospective-CURRENT_RATE_SCOPE.phaseBaseline>CURRENT_RATE_SCOPE.phaseCap)throw Error('RATE_PHASE_CAP');if(prospective-this.budget.baseline>this.budget.subcap)throw Error('RATE_SUBCAP');
 }
 private async waitUntil(until:RateClock){
  while(true){this.options.signal.throwIfAborted();const n=this.tick();const remaining=Math.max(0,until.wall-n.wall,until.mono-n.mono);if(!remaining)return n;await this.options.wait(Math.min(remaining,1000),this.options.signal);}
 }
 async startRun(receipt:number,hint:RateHint){
  if(this.closed)throw Error('RATE_CIRCUIT');if(this.busy||this.start||this.inflight)throw Error('RATE_INFLIGHT');if(this.run>=this.budget.runs)throw Error('RATE_RUN_LIMIT');this.busy=true;
  try{const plan=planRateCooldown(receipt,hint,this.tick(),this.expiry.wall);await this.waitUntil(plan);this.verify();const n=this.tick();
   if(rateSum(n.wall,P.runMs)>this.expiry.wall||rateSum(n.mono,P.runMs)>this.expiry.mono)throw Error('RATE_BATCH_EXPIRY');
   this.run++;this.requests=0;this.start=n;this.append('RUN_BEGIN',n);return {...n};
  }catch(e){this.closed=true;throw e;}finally{this.busy=false;}
 }
 async beforeClaim(id:string){
  if(this.closed)throw Error('RATE_CIRCUIT');if(this.busy||this.inflight)throw Error('RATE_INFLIGHT');if(!this.start||!/^call-[1-9]\d*$/u.test(id)||id!==`call-${this.requests+1}`)throw Error('RATE_TARGET');this.busy=true;
  try{const n=this.tick(),delay=ratePacingDelay(this.previousStart,n.mono,this.options.jitter());const ready=await this.waitUntil({wall:rateSum(n.wall,delay),mono:rateSum(n.mono,delay)});
   if(ready.wall-this.start.wall>=P.runMs||ready.mono-this.start.mono>=P.runMs)throw Error('RATE_RUN_EXPIRY');
   this.verify();const admitted=this.tick();this.checkRun(admitted);this.options.signal.throwIfAborted();if(this.requests>=P.requests||this.total>=this.budget.runs*P.requests)throw Error('RATE_REQUEST_LIMIT');
   this.append('CLAIM',admitted,id);this.requests++;this.total++;this.inflight={id,dispatched:false};
  }catch(e){this.closed=true;throw e;}finally{this.busy=false;}
 }
 dispatched(id:string){const n=this.tick();this.checkRun(n);this.options.signal.throwIfAborted();if(!this.inflight||this.inflight.id!==id||this.inflight.dispatched)throw Error('RATE_DISPATCH');this.append('DISPATCH',n,id);this.previousStart=n.mono;this.inflight.dispatched=true;}
 settled(id:string){const n=this.sample();if(!this.inflight||this.inflight.id!==id||!this.inflight.dispatched)throw Error('RATE_SETTLEMENT');this.append('FINISH',n,id);this.inflight=undefined;}
 finishRun(eligible:boolean){if(!this.start||this.inflight||this.busy)throw Error('RATE_UNSETTLED');const n=this.sample();const committed=eligible&&!this.closed&&!this.options.signal.aborted&&n.wall-this.start.wall<P.runMs&&n.mono-this.start.mono<P.runMs&&n.wall<this.expiry.wall&&n.mono<this.expiry.mono;this.append('RUN_END',n,undefined,committed);this.start=undefined;if(!committed)this.closed=true;return committed;}
 journalHead(){return this.rows.at(-1)!.hash;}
 stopIdle(reason:string){
  if(this.inflight||this.start||this.busy||JSON.stringify(readRateBatchJournal(this.options.directory))!==JSON.stringify(this.rows))throw Error('RATE_UNSETTLED');
  for(let run=1;run<=this.run;run++){const counts=['CLAIM','DISPATCH','FINISH'].map(event=>this.rows.filter(r=>r.run===run&&r.event===event).length);if(counts[0]!==counts[1]||counts[1]!==counts[2])throw Error('RATE_UNSETTLED');}
  this.append('BATCH_STOP',this.last,undefined,undefined,reason);this.closed=true;
 }
 assertChildSettled(physical:number){
  if(!rateNatural(physical)||this.inflight||JSON.stringify(readRateBatchJournal(this.options.directory))!==JSON.stringify(this.rows))throw Error('RATE_UNSETTLED');
  for(const event of ['CLAIM','DISPATCH','FINISH'])if(this.rows.filter(r=>r.run===this.run&&r.event===event).length!==physical)throw Error('RATE_UNSETTLED');
 }
 executionState(){if(!this.start)throw Error('RATE_RUN_REQUIRED');return {recordDigest:this.options.recordDigest,ordinal:this.run,startedAt:this.start.wall,now:this.sample().wall};}
 get ordinal(){return this.run;}
}
