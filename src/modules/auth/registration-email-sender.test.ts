import { expect,it,vi } from 'vitest';
import { createRegistrationEmailSender } from './registration-email-sender';
it('requires a valid configured binding and sender, with no bot fallback',()=>{
 expect(createRegistrationEmailSender(undefined,'no-reply@example.com')).toBeUndefined();
 expect(createRegistrationEmailSender({send:vi.fn()},'bad\r\nBcc: victim@example.com')).toBeUndefined();
});
it('sends one plain-text OTP message and rejects missing acknowledgement without retries',async()=>{
 const send=vi.fn().mockResolvedValue({messageId:'accepted-id'}),sender=createRegistrationEmailSender({send},'no-reply@example.com')!;
 await sender.send({to:'owner@gmail.com',code:'123456',expiresAt:1});
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({to:'owner@gmail.com',from:'no-reply@example.com',subject:'Mã xác minh Calenote'});
 expect(send.mock.calls[0][0].text).toContain('123456');
 send.mockResolvedValue({});await expect(sender.send({to:'owner@gmail.com',code:'123456',expiresAt:1})).rejects.toThrow('EMAIL_DELIVERY_UNCONFIRMED');
 expect(send).toHaveBeenCalledTimes(2);
});
