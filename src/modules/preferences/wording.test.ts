import { expect,it } from 'vitest';
import { addressProse,botSalutation } from './wording';
it.each([
 ['ban',null,'','Bạn muốn mình nhắc gì?'],
 ['sep',null,'Sếp, ','Sếp muốn mình nhắc gì?'],
 ['anh_chi',null,'Anh/chị, ','Anh/chị muốn mình nhắc gì?'],
 ['ong_tui',null,'Ông, ','Ông muốn tui nhắc gì?'],
 ['minh',null,'Mình, ','Mình muốn tớ nhắc gì?'],
 ['custom','Chị Tuyền','Chị Tuyền, ','Chị Tuyền muốn mình nhắc gì?'],
] as const)('renders %s consistently', (addressStyle,customDisplayName,salutation,phrase)=>{
 const prefs={addressStyle,customDisplayName};expect(botSalutation(prefs)).toBe(salutation);expect(addressProse('Bạn muốn mình nhắc gì?',prefs)).toBe(phrase);
});
it('replaces once, preserves words inside a custom name and strips control characters',()=>{
 const prefs={addressStyle:'custom' as const,customDisplayName:'Bạn Mình\nTân'};
 expect(addressProse('Bạn nhé, mình sẽ nhắc.',prefs)).toBe('Bạn Mình Tân nhé, mình sẽ nhắc.');
 expect(botSalutation(prefs)).toBe('Bạn Mình Tân, ');
 expect(botSalutation()).toBe('');
});
