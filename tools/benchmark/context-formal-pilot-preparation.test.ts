// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendCampaignEvent,reserveCampaignCall,markCampaignDispatched,finishCampaignCall} from './context-contract-live';
import {prepareTypedFormalPilot,inspectTypedFormalPilotPreparation} from './context-formal-pilot-preparation';
import {loadFormalPilotLaunch,runFormalPilotLaunch} from './context-formal-pilot-launcher';
const candidate='575c659896862bbdc182632ae1ac3438fe98283b';
function fixture(){const accountRoot=realpathSync(mkdtempSync(join(tmpdir(),'prepared105-'))),campaignRoot=join(accountRoot,'history'),directory=join(campaignRoot,'PILOT');mkdirSync(directory,{recursive:true});
 appendCampaignEvent(directory,{event:'BEGIN',runId:'unknown',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1});
 reserveCampaignCall(directory,{runId:'unknown',profile:'PILOT',provenanceDigest:'b'.repeat(64),reservationId:'unknown',maximumMicrounits:100000,now:1,startedAt:1});markCampaignDispatched(directory,{runId:'unknown',reservationId:'unknown',at:1});finishCampaignCall(directory,{runId:'unknown',reservationId:'unknown',at:1,observedMicrounits:null});appendCampaignEvent(directory,{event:'STOP',runId:'unknown',at:1,reason:'TERMINAL'});
 return {accountRoot,campaignRoot,directory,cleanup:()=>rmSync(accountRoot,{recursive:true,force:true})};}
it('prepares and rechecks HOLD without touching history or granting credential/dispatch authority',async()=>{
 const f=fixture(),network=vi.fn(),key=vi.fn();vi.stubGlobal('fetch',network);
 try{const before=readFileSync(join(f.directory,'campaign.jsonl'),'utf8'),names=readdirSync(f.accountRoot);
  const packet=prepareTypedFormalPilot(process.cwd(),candidate,f.accountRoot,f.campaignRoot);
  expect(packet).toMatchObject({paid:'HOLD',status:'PREPARED_HOLD',wireProtocol:'TYPED_105',hardCapMicrounits:10000000,accountingPolicy:'CONSERVATIVE_DEBUG_V1',retry:0,fullStarted:false,model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu'});
  expect(packet.accounting).toMatchObject({unknownCount:1,conservativeRetainedMicrounits:100000,remainingConservativeMicrounits:9900000});
  expect(inspectTypedFormalPilotPreparation(process.cwd(),packet)).toEqual(packet);
  expect(()=>loadFormalPilotLaunch(process.cwd(),join(f.accountRoot,'missing-launch.json'),packet as never)).toThrow();
  await expect(runFormalPilotLaunch(undefined,key)).rejects.toThrow('FORMAL_AUTHORITY_REQUIRED');
  expect(key).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();expect(readdirSync(f.accountRoot)).toEqual(names);expect(readFileSync(join(f.directory,'campaign.jsonl'),'utf8')).toBe(before);
  for(const patch of [{paid:'AUTHORIZED_ONE_FORMAL_PILOT'},{hardCapMicrounits:10000001},{wireProtocol:'HISTORICAL_104'},{inventoryDigest:'0'.repeat(64)},{evaluationCandidateSha:'b11c7d439ab79467f1e2c843723f4548d0a3e29f'}])expect(()=>inspectTypedFormalPilotPreparation(process.cwd(),{...packet,...patch})).toThrow();
  const late=join(f.accountRoot,'late','PILOT');mkdirSync(late,{recursive:true});appendCampaignEvent(late,{event:'BEGIN',runId:'late',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:2});
  expect(()=>inspectTypedFormalPilotPreparation(process.cwd(),packet)).toThrow();
 }finally{vi.unstubAllGlobals();f.cleanup();}
});
