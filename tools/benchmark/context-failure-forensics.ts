/** Pilot-only encrypted evidence. No credentials, network or plaintext persistence. */
import {createCipheriv,createHash,publicEncrypt,randomBytes,constants} from 'node:crypto';
export async function sealProviderFailure(response:Response,publicKey:string,includeSuccess=false){
 if(response.status===200&&!includeSuccess)return {state:'NOT_FAILURE'} as const;
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  reader=response.clone().body?.getReader();if(!reader)return {state:'CAPTURE_UNAVAILABLE',reason:'BODY_MISSING'} as const;
  // 8192 raw bytes + base64/encryption envelope stays below the 16KiB journal cap.
  const chunks:Buffer[]=[];let size=0;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('READ_TIMEOUT')),5000);});
  for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.byteLength;if(size>8192)return {state:'CAPTURE_UNAVAILABLE',reason:'BODY_LIMIT'} as const;chunks.push(Buffer.from(part.value));}
  const bytes=Buffer.concat(chunks),key=randomBytes(32),iv=randomBytes(12);
  try{
   const cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
   const wrappedKey=publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key);
   return {state:'SEALED',version:'provider-failure-sealed-1',algorithm:'RSA-OAEP-SHA256+AES-256-GCM',httpStatus:response.status,bodyBytes:size,bodySha256:createHash('sha256').update(bytes).digest('hex'),publicKeySha256:createHash('sha256').update(publicKey).digest('hex'),wrappedKey:wrappedKey.toString('base64'),iv:iv.toString('base64'),authTag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')} as const;
  }finally{key.fill(0);bytes.fill(0);}
 }catch{return {state:'CAPTURE_UNAVAILABLE',reason:'READ_OR_SEAL_FAILED'} as const;}
 finally{if(timer)clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{});}
}

// Public encryption recipient only; private key is outside the repository.
export const PILOT_FAILURE_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA8cf8dnSH55pA+rSMdo0s\nCw7ggC61RVpL44Ct7NEtLBmwKHCW1+bom/62w9ET4aMMBSzbKaTvVV+yfHlbsyHI\nssbj3m3M766f+QpatIkOxn9PGA/o860mG9sJpOuJdr+Kz3pEp5CgCr/dvtRLQaIt\nWWf2RMU6hCLS4E69XBnqcT4wUfZcOjnHrKpGZ0L4m8aKsJzpjHf7SUX/IvJqHsvf\nqu5nv6oFtwYada7A0m9wo0A0myatCPz42xBy/dQ38+5LNeBxNrLtXQzS0SgfosRS\nEljwA3TwQ6FI85sgj7/jgSaokLyciBeqgc/hHB8tDEvRBKzCG3myX3w+HtENaahd\nnMjDBUIqgLlEWq/0mIGIhwHtN7FneyhnjmVNx8+/+xfbyU99b2Z2/iAB3FB9d7T7\naH7H3o6YQn70qa6kAnuDR1iUTQLzc9bcg59nRjruhD1bLT9pwmn+wk+OgNNN3XGc\nvti/wrACAsrhKqw/1NfoviaV/KWrXMtQ6EfRonfp5sI5AgMBAAE=\n-----END PUBLIC KEY-----\n';
