// @vitest-environment node
import {expect,it} from 'vitest';
import {servingRelease} from './release-runtime';
const origin='https://calenote.iconiclogs.com';
const id='5479e5bc-6cd0-4628-b7ca-8f249cfc0ef9';
const sha='78334ca3bb6703164cffa1e42b408c321687d959';
const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',CF_VERSION_METADATA:{id,tag:sha,timestamp:'2026-10-20T09:38:00Z'}};
it('reads the responding version without calling upload time a release timestamp',()=>{
 expect(servingRelease(new Request(origin+'/api/product-updates?runtime=1'),env)).toEqual({status:'SERVING',versionId:id,tag:sha});
});
it('changes with a new serving version and rollback without catalogue mutation',()=>{
 const next={...env,CF_VERSION_METADATA:{...env.CF_VERSION_METADATA,id:'788420ea-c791-4a12-ade6-e512f709a27e',tag:'a'.repeat(40)}};
 expect(servingRelease(new Request(origin),next)).toEqual({status:'SERVING',versionId:next.CF_VERSION_METADATA.id,tag:'a'.repeat(40)});
 expect(servingRelease(new Request(origin),env)).toEqual({status:'SERVING',versionId:id,tag:sha});
});
it('never treats local or version preview URLs as production, even with production vars',()=>{
 for(const url of ['http://localhost:8787','https://preview.calenote.workers.dev'])expect(servingRelease(new Request(url),env)).toEqual({status:'NON_PRODUCTION'});
 expect(servingRelease(new Request(origin),{...env,CALENOTE_RUNTIME_ENVIRONMENT:'staging'})).toEqual({status:'NON_PRODUCTION'});
 expect(servingRelease(new Request('https://localhost:8787'),{...env,APP_ORIGIN:'https://localhost:8787'})).toEqual({status:'NON_PRODUCTION'});
 expect(servingRelease(new Request('https://preview.calenote.workers.dev'),{...env,APP_ORIGIN:'https://preview.calenote.workers.dev'})).toEqual({status:'NON_PRODUCTION'});
});
it('does not guess from missing/malformed metadata, request headers or catalogues',()=>{
 for(const metadata of [undefined,{id:'bad',tag:sha},{id:'5479e5bc-6cd0-9628-77ca-8f249cfc0ef9',tag:sha},{id,tag:'<b>unknown-tag</b>'}]){
  const result=servingRelease(new Request(origin,{headers:{'x-release-sha':sha}}),{...env,CF_VERSION_METADATA:metadata});
  expect(result).toEqual(metadata?.id===id?{status:'SERVING',versionId:id,tag:null}:{status:'UNKNOWN'});
 }
 expect(servingRelease(new Request(origin),{...env,APP_ORIGIN:'not a URL'})).toEqual({status:'UNKNOWN'});
});
