import {expect,it} from 'vitest';
import {PersonalAssistantDocumentSchema,initialPersonalAssistantDocument} from '@/contracts/api/personal-assistant';
import {addEventCategory,suggestEventCategory} from './EventCategories';
const event={id:'event',title:'Thay nhớt',kind:'OTHER' as const,calendar:'SOLAR' as const,month:1,day:1,time:'08:00',leapPolicy:'REGULAR' as const,missingDayPolicy:'SKIP' as const,leadDays:[0],enabled:false};
it('creates and reuses normalized account-local categories, including built-ins',()=>{
 const document={...initialPersonalAssistantDocument(),events:[event]};
 const added=addEventCategory(document,'event','  Chăm   xe ');expect(added.categories).toHaveLength(1);expect(added.categories![0].name).toBe('Chăm xe');
 const reused=addEventCategory(added,'event','CHĂM XE');expect(reused.categories).toHaveLength(1);expect(reused.events[0].categoryId).toBe(added.events[0].categoryId);
 const builtin=addEventCategory(reused,'event','SINH NHẬT');expect(builtin.events[0].kind).toBe('BIRTHDAY');expect(builtin.events[0].categoryId).toBeUndefined();
 expect(PersonalAssistantDocumentSchema.safeParse(reused).success).toBe(true);
});
it('reads old documents and rejects dangling or duplicate categories at API boundary',()=>{
 const old={...initialPersonalAssistantDocument(),events:[event]};expect(PersonalAssistantDocumentSchema.safeParse(old).success).toBe(true);
 expect(PersonalAssistantDocumentSchema.safeParse({...old,events:[{...event,categoryId:'missing'}]}).success).toBe(false);
 expect(PersonalAssistantDocumentSchema.safeParse({...old,categories:[{id:'one',name:'Chăm xe'},{id:'two',name:' CHĂM XE '}]}).success).toBe(false);
 expect(PersonalAssistantDocumentSchema.safeParse({...old,categories:[{id:'one',name:'Sinh nhật'}]}).success).toBe(false);
});

it('offers bounded useful hints without mutating the document or guessing unknown titles',()=>{
 const document=initialPersonalAssistantDocument(),before=JSON.stringify(document);
 expect(suggestEventCategory('Nhắc thay nhớt xe',document)).toBe('Chăm xe');
 expect(suggestEventCategory('Nhắc tái khám',document)).toBe('Sức khỏe');
 expect(suggestEventCategory('Gọi cho Nam',document)).toBeUndefined();
 expect(JSON.stringify(document)).toBe(before);
});
