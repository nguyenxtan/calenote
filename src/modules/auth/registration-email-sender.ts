import type { EmailRegistrationSender } from './email-registration';
import { otpEmail, welcomeEmail } from './email-templates';
export interface RegistrationEmailBinding { send(message:{to:string;from:string;subject:string;text:string;html:string}):Promise<{messageId:string}>; }
/** Binding is configured only after sender-domain qualification. Never fall back to a bot. */
export function createRegistrationEmailSender(binding:RegistrationEmailBinding|undefined,from:string|undefined,appOrigin?:string):EmailRegistrationSender|undefined {
 if(!binding||typeof from!=='string'||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u.test(from))return undefined;
 const deliver=async(to:string,message:{subject:string;text:string;html:string})=>{
  const result=await binding.send({to,from,...message});
  if(!result||typeof result.messageId!=='string'||!result.messageId)throw new Error('EMAIL_DELIVERY_UNCONFIRMED');
 };
 return {
  send:async ({to,code})=>deliver(to,otpEmail(code)),
  sendWelcome:async ({to,displayName})=>deliver(to,welcomeEmail(displayName,appOrigin)),
 };
}
