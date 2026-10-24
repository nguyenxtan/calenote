// @vitest-environment node
import {it,expect} from 'vitest';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants,createHash} from 'node:crypto';
import {sealProviderFailure} from './context-failure-forensics';
it('retains exact unrecognized provider reason encrypted without plaintext or an extra fetch',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const text=JSON.stringify({error:{code:404,message:'A previously unknown exact provider explanation PRIVATE',metadata:{private:'SYNTHETIC_SECRET'}}});
 const response=new Response(text,{status:404});
 const e=await sealProviderFailure(response,keys.publicKey.export({type:'spki',format:'pem'}).toString());
 expect(e.state).toBe('SEALED');if(e.state!=='SEALED'||e.version!=='provider-failure-sealed-1')throw Error('complete capture');
 expect(JSON.stringify(e)).not.toContain('PRIVATE');expect(JSON.stringify(e)).not.toContain('SYNTHETIC_SECRET');
 const key=privateDecrypt({key:keys.privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.wrappedKey,'base64'));
 const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));cipher.setAuthTag(Buffer.from(e.authTag,'base64'));
 const plain=Buffer.concat([cipher.update(Buffer.from(e.ciphertext,'base64')),cipher.final()]);
 expect(plain.toString()).toBe(text);expect(e.bodySha256).toBe(createHash('sha256').update(plain).digest('hex'));
 expect(await response.text()).toBe(text);
});
it('skips successful model content and stops oversized evidence without returning bytes',async()=>{
 expect(await sealProviderFailure(new Response('PRIVATE',{status:200}),'invalid')).toEqual({state:'NOT_FAILURE'});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const result=await sealProviderFailure(new Response('x'.repeat(32769),{status:404}),keys.publicKey.export({type:'spki',format:'pem'}).toString());
 expect(result).toEqual({state:'CAPTURE_UNAVAILABLE',reason:'BODY_LIMIT'});
});
it('explicit Pilot opt-in retains encrypted HTTP200 evidence for offline decoder diagnosis',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const body=JSON.stringify({choices:[{message:{content:'SYNTHETIC_PRIVATE_TYPED_PAYLOAD'}}]});
 const r=await sealProviderFailure(new Response(body,{status:200}),keys.publicKey.export({type:'spki',format:'pem'}).toString(),true);
 expect(r.state).toBe('SEALED');expect(JSON.stringify(r)).not.toContain('SYNTHETIC_PRIVATE_TYPED_PAYLOAD');
 if(r.state!=='SEALED')throw Error('not sealed');
 const key=privateDecrypt({key:keys.privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(r.wrappedKey,'base64'));
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(r.iv,'base64'));decipher.setAuthTag(Buffer.from(r.authTag,'base64'));
 expect(Buffer.concat([decipher.update(Buffer.from(r.ciphertext,'base64')),decipher.final()]).toString()).toBe(body);
});
it.each([8191,8192,8193,33983])('Pilot forensic evidence bounds encrypted capture at %i bytes with honest prefix metadata',async(length)=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});const body='PRIVATE_PREFIX_'+'.'.repeat(length-16)+'!';expect(Buffer.byteLength(body)).toBe(length);
 const r=await sealProviderFailure(new Response(body),keys.publicKey.export({type:'spki',format:'pem'}).toString(),true);
 const e=r as unknown as Record<string,unknown>;expect(e.state).toBe('SEALED');expect(JSON.stringify(r)).not.toContain('PRIVATE_PREFIX');expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(16384);
 if(length>8192){expect(e.version).toBe('provider-failure-sealed-prefix-1');expect(e.capture).toBe('TRUNCATED_PREFIX');expect(e.capturedBytes).toBe(8192);expect(e.observedBytesLowerBound).toBe(length);expect(e).not.toHaveProperty('bodySha256');expect(e).not.toHaveProperty('bodyBytes');}
 else {expect(e.version).toBe('provider-failure-sealed-1');expect(e.bodyBytes).toBe(length);}
 const key=privateDecrypt({key:keys.privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.wrappedKey as string,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv as string,'base64'));decipher.setAuthTag(Buffer.from(e.authTag as string,'base64'));const plain=Buffer.concat([decipher.update(Buffer.from(e.ciphertext as string,'base64')),decipher.final()]);
 expect(plain.toString()).toBe(body.slice(0,8192));expect(e[length>8192?'capturedSha256':'bodySha256']).toBe(createHash('sha256').update(plain).digest('hex'));
});
it('captures across chunk boundary and cancels only the clone without consuming the original',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});const parts=[Buffer.alloc(8191,97),Buffer.from('BC'),Buffer.alloc(100,99)];let index=0;const response=new Response(new ReadableStream({pull(c){if(index<parts.length)c.enqueue(parts[index++]);else c.close();}}));
 const r=await sealProviderFailure(response,keys.publicKey.export({type:'spki',format:'pem'}).toString(),true);expect(r).toMatchObject({state:'SEALED',capture:'TRUNCATED_PREFIX',capturedBytes:8192,observedBytesLowerBound:8193});expect((await response.arrayBuffer()).byteLength).toBe(8293);
});
