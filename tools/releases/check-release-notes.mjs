import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const catalogPath='src/modules/releases/catalog.json';
function requireValue(condition,message){if(!condition)throw new Error(message);}
export function validateCatalog(catalog){
 requireValue(catalog&&Array.isArray(catalog.notes)&&catalog.notes.length>0,'Missing release catalogue');
 requireValue(catalog.latestId===catalog.notes[0].id,'Latest release must be first');
 requireValue(new Set(catalog.notes.map(note=>note.id)).size===catalog.notes.length,'Duplicate release IDs');
 catalog.notes.forEach((note,index)=>{
  requireValue(typeof note.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(note.id),'Invalid release ID');
  for(const field of ['title','summary','verification'])requireValue(typeof note[field]==='string'&&note[field].trim().length>0,`Missing ${field}`);
  for(const field of ['changes','memberChanges'])requireValue(Array.isArray(note[field])&&note[field].length>0&&note[field].every(value=>typeof value==='string'&&value.trim().length>0),`Missing ${field}`);
  requireValue(['Sửa lỗi','Tính năng'].includes(note.kind),'Invalid release kind');
  if(index===0){
   requireValue(note.commit===null&&note.releasedAt===null,'Current bundle must not invent its own commit or live verification timestamp');
   requireValue(!/(?:chưa|đã)\s+(?:phát hành|triển khai|release|deploy)|đang\s+(?:kiểm tra|kiểm thử|test)/iu.test(note.verification),'Current verification must describe test scope, not transient runtime status');
  }
  else requireValue(/^[a-f0-9]{40}$/.test(note.commit)&&Number.isFinite(Date.parse(note.releasedAt)),'Historical release needs a commit and timestamp');
 });
 const history=catalog.notes.slice(1);
 requireValue(new Set(history.map(note=>note.commit)).size===history.length,'Duplicate historical commits');
 requireValue(history.every((note,index)=>index===0||Date.parse(note.releasedAt)<=Date.parse(history[index-1].releasedAt)),'History must be newest first');
 return catalog;
}
export function checkReleaseGate(current,previous,changed){
 validateCatalog(current);
 const productChanged=changed.some(path=>/^(src\/|migrations\/)/.test(path)&&!/(\.test\.|test-support|^src\/testing\/)/.test(path)&&path!==catalogPath)||changed.some(path=>['wrangler.jsonc','package.json','pnpm-lock.yaml'].includes(path));
 if(!productChanged)return;
 requireValue(changed.includes(catalogPath),'Product changes require a release note for both members and admin');
 if(previous){
  requireValue(current.latestId!==previous.latestId,'Product changes require a new release ID');
  for(const note of previous.notes)requireValue(current.notes.some(item=>item.id===note.id),'Do not remove prior release history');
 }
}
function git(args){return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
export function run(){
 let base=process.env.RELEASE_BASE_REF||'origin/master';
 const head=git(['rev-parse','HEAD']);
 if(git(['rev-parse',base])===head){
  const event=process.env.GITHUB_EVENT_PATH?JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):{};
  base=/^[a-f0-9]{40}$/.test(event.before??'')&&!/^0+$/.test(event.before)?event.before:'HEAD^';
 }
 git(['rev-parse','--verify',`${base}^{commit}`]);
 const changed=git(['diff','--name-only',`${base}...HEAD`]).split('\n').filter(Boolean);
 let previous=null;
 const files=git(['ls-tree','--name-only',base,catalogPath]);
 if(files)previous=JSON.parse(git(['show',`${base}:${catalogPath}`]));
 checkReleaseGate(JSON.parse(readFileSync(catalogPath,'utf8')),previous,changed);
 console.log('Release notes gate passed: one catalogue for member notifications and admin history.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{run();}catch(error){console.error(`Release notes gate failed: ${error.message}`);process.exitCode=1;}}
