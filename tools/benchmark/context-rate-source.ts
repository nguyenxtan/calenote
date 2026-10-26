import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {contextCampaignGitEnvironment} from './context-contract-live';
/** HEAD alone cannot label dirty/untracked/ignored harness bytes CI-green. */
export function assertRateHarnessCommit(root:string,revision:string){
 try{
  if(realpathSync(root)!==root||!/^[a-f0-9]{40}$/u.test(revision))throw Error();
  const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:contextCampaignGitEnvironment});
  if(git(['rev-parse','HEAD']).trim()!==revision||git(['status','--porcelain=v1','--untracked-files=all']))throw Error();
  const entries=git(['ls-tree','-rz',revision,'--','tools/benchmark','vitest.config.ts','vitest.setup.ts']).split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');const [mode,type,blob]=meta.split(' ');if(type!=='blob'||!['100644','100755'].includes(mode))throw Error();return {path,blob};});
  const actual:string[]=[];function walk(path:string){for(const e of readdirSync(join(root,path),{withFileTypes:true})){if(e.isSymbolicLink())throw Error();const child=`${path}/${e.name}`;if(e.isDirectory())walk(child);else if(e.isFile())actual.push(child);else throw Error();}}
  walk('tools/benchmark');actual.push('vitest.config.ts','vitest.setup.ts');actual.sort();if(JSON.stringify(actual)!==JSON.stringify(entries.map(e=>e.path).sort()))throw Error();
  for(const e of entries){if(lstatSync(join(root,e.path)).isSymbolicLink())throw Error();const bytes=readFileSync(join(root,e.path));if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==e.blob)throw Error();}
 }catch{throw Error('RATE_HARNESS_COMMIT');}
}
