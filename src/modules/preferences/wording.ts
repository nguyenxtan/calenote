import type { UserPreferences } from './service';

export type BotReplyPreferences = Pick<UserPreferences,'addressStyle'|'customDisplayName'> & Partial<Pick<UserPreferences,'tone'>>;
export type BotReplyPreferencesGetter = (ownerId:string)=>Promise<BotReplyPreferences>;
function words(preferences:BotReplyPreferences){
 const custom=preferences.customDisplayName?.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').trim();
 const name=custom ? [...custom].slice(0,80).join('') : 'bạn';
 return {address:({ban:'bạn',anh_chi:'anh/chị',ong_tui:'ông',minh:'mình',sep:'sếp',custom:name})[preferences.addressStyle],
  self:preferences.addressStyle==='ong_tui'?'tui':preferences.addressStyle==='minh'?'tớ':'mình'};
}
/** Plain text, not HTML. Only apply to literal application-owned prose, never owner/model payload. */
export function addressProse(text:string,preferences?:BotReplyPreferences):string{
 if(!preferences||preferences.addressStyle==='ban')return text;
 const {address,self}=words(preferences);
 return text.replace(/(^|[^\p{L}\p{N}_])(bạn|Bạn|mình|Mình)(?=$|[^\p{L}\p{N}_])/gu,(_match,prefix:string,word:string)=>{
  const replacement=word.toLowerCase()==='bạn'?address:self;
  const capitalized=word[0]===word[0].toUpperCase()&&preferences.addressStyle!=='custom'
   ? replacement[0].toLocaleUpperCase('vi-VN')+replacement.slice(1):replacement;
  return prefix+capitalized;
 });
}
/** Plain text prefix. Structured/HTML renderers must escape and account for its size/spans. */
export function botSalutation(preferences?:BotReplyPreferences):string{
 if(!preferences||preferences.addressStyle==='ban')return '';
 const {address}=words(preferences);
 return (preferences.addressStyle==='custom'?address:address[0].toLocaleUpperCase('vi-VN')+address.slice(1))+', ';
}
