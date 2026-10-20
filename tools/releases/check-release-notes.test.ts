// @vitest-environment node
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Node-only JS release gate is validated by its own tests
import {checkReleaseGate,validateCatalog} from './check-release-notes.mjs';
const source=()=>JSON.parse(readFileSync('src/modules/releases/catalog.json','utf8'));
it('validates the shared current bundle and verified history',()=>{expect(()=>validateCatalog(source())).not.toThrow();});
it('blocks product releases that omit a catalogue or reuse the previous release ID',()=>{
 const current=source();expect(()=>checkReleaseGate(current,null,['src/features/foo.tsx'])).toThrow(/release note/);
 expect(()=>checkReleaseGate(current,current,['src/features/foo.tsx','src/modules/releases/catalog.json'])).toThrow(/new release ID/);
});
it('requires member wording and retains historical releases',()=>{
 const current=source();current.notes[0].memberChanges=[];expect(()=>validateCatalog(current)).toThrow(/memberChanges/);
 const next=source(),previous=source();previous.latestId='older';previous.notes.push({...previous.notes[1],id:'missing'});
 expect(()=>checkReleaseGate(next,previous,['src/a.ts','src/modules/releases/catalog.json'])).toThrow(/prior release history/);
});
it('does not require a version bump for tests/docs alone',()=>{const current=source();expect(()=>checkReleaseGate(current,current,['src/a.test.ts','docs/runbooks/a.md'])).not.toThrow();});

it('rejects out-of-order or duplicate historical commits',()=>{
 const out=source();[out.notes[1],out.notes[2]]=[out.notes[2],out.notes[1]];expect(()=>validateCatalog(out)).toThrow(/newest first/);
 const duplicate=source();duplicate.notes[2].commit=duplicate.notes[1].commit;expect(()=>validateCatalog(duplicate)).toThrow(/Duplicate historical commits/);
});
