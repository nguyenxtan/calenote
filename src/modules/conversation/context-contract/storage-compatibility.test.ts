// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {ContextSnapshotV2Schema,decodeContextSnapshot,decodeContextSnapshotV2,encodeContextSnapshot,encodeContextSnapshotV2} from './state';

// Captured by evaluating the production463b0dc encoder, not this checkout's
// dictionary. Both the logical input and old serialized envelope are checked in.
it.each([1,2])('decodes production storage2 state%s and preserves its exact bytes when no new member is used',version=>{
 const fixture=JSON.parse(readFileSync(new URL(`./__fixtures__/storage2-production-state${version}.json`,import.meta.url),'utf8'));
 const expected=version===1?'d14b9ca2f9d7092fe79a4534bfea48479975ed40b6e8bb3b06fb09a981e7bb68':'01e19b658def217ad070c71efafa8c98ed7cd101780a1a6871fa329ee609d70a';
 expect(createHash('sha256').update(fixture.encoded).digest('hex')).toBe(expected);
 expect(fixture.sourceCommit).toBe('463b0dc19c30d559befc43a8c07e2a48fa3ef72d');
 const decoded=version===1?decodeContextSnapshot(fixture.encoded):decodeContextSnapshotV2(fixture.encoded);
 expect(decoded).toEqual(fixture.logical);
 expect(version===1?encodeContextSnapshot(decoded):encodeContextSnapshotV2(ContextSnapshotV2Schema.parse(decoded))).toBe(fixture.encoded);
 const envelope=JSON.parse(fixture.encoded);
 expect(envelope.snapshot.transcript[0].sourceMap).toBeUndefined();
 expect(envelope.snapshot.transcript[0].$k0).toBeUndefined();
 // normalizationVersion is index0; evidenceIndex is the last historical key59.
 expect(envelope.snapshot.transcript[0].$k9.$k0).toBe('nfc-codepoint-v1');
});

it('pins the final historical evidenceIndex key and appends deliveredAt after it',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./__fixtures__/storage2-production-decision.json',import.meta.url),'utf8'));
 expect(createHash('sha256').update(fixture.encoded).digest('hex')).toBe('ece73777500d8eddcc7b01e0073209a481b2191b19ff2d6098832bf69479ab7c');
 const decoded=decodeContextSnapshotV2(fixture.encoded);
 expect(decoded).toEqual(fixture.logical);expect(encodeContextSnapshotV2(decoded)).toBe(fixture.encoded);
 const old=JSON.parse(fixture.encoded);expect(old.snapshot.$kz.candidate.$k1n).toHaveLength(1);
 const deliveredAt='2026-09-28T03:00:01.000Z';
 const current=ContextSnapshotV2Schema.parse({...decoded,pendingDecision:{...decoded.pendingDecision,deliveredAt}});
 expect(JSON.parse(encodeContextSnapshotV2(current)).snapshot.$kz.$k1o).toBe(deliveredAt);
 expect(decodeContextSnapshotV2(encodeContextSnapshotV2(current))).toEqual(current);
});
