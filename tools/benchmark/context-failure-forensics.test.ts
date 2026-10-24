// @vitest-environment node
import {it,expect} from 'vitest';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants,createHash} from 'node:crypto';
import {sealProviderFailure} from './context-failure-forensics';
it('retains exact unrecognized provider reason encrypted without plaintext or an extra fetch',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const text=JSON.stringify({error:{code:404,message:'A previously unknown exact provider explanation PRIVATE',metadata:{private:'SYNTHETIC_SECRET'}}});
 const response=new Response(text,{status:404});
 const e=await sealProviderFailure(response,keys.publicKey.export({type:'spki',format:'pem'}).toString());
 expect(e.state).toBe('SEALED');if(e.state!=='SEALED')throw Error('capture');
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
