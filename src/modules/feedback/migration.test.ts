// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {it,expect} from 'vitest';
import {semanticRuntime} from '@/modules/semantic/infrastructure/d1/runtime.test-support';
it('applies0019 after complete reviewed0018 baseline on disposable D1, preserves existing rows and foreign keys',async()=>{
 const {runtime,db}=await semanticRuntime();
 try{
  for(const file of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort()){
   if(file.startsWith('0019'))await db.prepare("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('preserved','preserved@example.test','Giữ nguyên','Asia/Ho_Chi_Minh',1,1)").run();
   await db.exec(readFileSync('migrations/'+file,'utf8').replace(/^\s*--.*$/gm,'').replace(/\n/g,' '));
  }
  expect(await db.prepare("SELECT display_name FROM users WHERE id='preserved'").first('display_name')).toBe('Giữ nguyên');
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  expect((await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'feedback_%'").all()).results).toHaveLength(2);
 }finally{await runtime.dispose();}
},20000);
