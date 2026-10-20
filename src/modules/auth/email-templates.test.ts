import {expect,it} from 'vitest';
import {otpEmail,welcomeEmail} from './email-templates';
it('renders self-contained accessible HTML and equivalent text without external trackers',()=>{
 for(const message of [otpEmail('123456'),welcomeEmail('Bạn','https://calenote.example.com')]){
  expect(message.html).toContain('lang="vi"');expect(message.html).toContain('max-width:560px');expect(message.text.length).toBeGreaterThan(100);
  expect(message.html).not.toMatch(/<script|<img|<iframe|@import/iu);
 }
 expect(()=>otpEmail('<html>')).toThrow();
});
it('never creates credential links or insecure welcome actions',()=>{
 expect(welcomeEmail('Bạn','http://app.example.com').html).not.toContain('href=');
 expect(welcomeEmail('Bạn','https://user:pass@app.example.com').html).not.toContain('href=');
 expect(otpEmail('012345').html).toContain('012345');
});
