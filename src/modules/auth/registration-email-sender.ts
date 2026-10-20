import type { EmailRegistrationSender } from './email-registration';
export interface RegistrationEmailBinding { send(message:{to:string;from:string;subject:string;text:string}):Promise<{messageId:string}>; }
/** Binding is configured only after sender-domain qualification. Never fall back to a bot. */
export function createRegistrationEmailSender(binding:RegistrationEmailBinding|undefined,from:string|undefined):EmailRegistrationSender|undefined {
 if(!binding||typeof from!=='string'||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u.test(from))return undefined;
 return {send:async ({to,code})=>{
  const result=await binding.send({to,from,subject:'Mã xác minh Calenote',text:`Mã xác minh Calenote của bạn: ${code}\n\nMã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu mã, hãy bỏ qua email này.`});
  if(!result||typeof result.messageId!=='string'||!result.messageId)throw new Error('EMAIL_DELIVERY_UNCONFIRMED');
 }};
}
