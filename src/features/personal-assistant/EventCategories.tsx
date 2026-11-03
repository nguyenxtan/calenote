"use client";
import { useState } from "react";
import { BUILTIN_EVENT_KINDS, normalizeCategoryName, type PersonalAssistantDocument, type PersonalLifeEvent } from "@/contracts/api/personal-assistant";

export function EventCategoryField({ event, document, onChange, onCreate }: {event:PersonalLifeEvent; document:PersonalAssistantDocument; onChange:(patch:Partial<PersonalLifeEvent>)=>void; onCreate:(name:string)=>void}) {
 const suggestion=suggestEventCategory(event.title,document);
 const current=event.categoryId?document.categories?.find(category=>category.id===event.categoryId)?.name:BUILTIN_EVENT_KINDS[event.kind];
 const [creating,setCreating]=useState(false);
 const [name,setName]=useState("");
 return <div><label>Loại<select value={creating?"CREATE":event.categoryId?`custom:${event.categoryId}`:event.kind} onChange={e=>{
  const value=e.target.value;
  if(value==="CREATE"){setCreating(true);return;}
  setCreating(false);
  onChange(value.startsWith("custom:")?{kind:"OTHER",categoryId:value.slice(7)}:{kind:value as PersonalLifeEvent["kind"],categoryId:undefined});
 }}>{Object.entries(BUILTIN_EVENT_KINDS).map(([value,label])=><option key={value} value={value}>{label}</option>)}{(document.categories??[]).map(category=><option key={category.id} value={`custom:${category.id}`}>{category.name}</option>)}<option value="CREATE">＋ Tạo loại mới</option></select></label>
 {suggestion&&normalizeCategoryName(suggestion)!==normalizeCategoryName(current??"")&&<button type="button" onClick={()=>onCreate(suggestion)}>Gợi ý: {suggestion}</button>}
 {creating&&<div><label>Tên loại mới<input maxLength={50} value={name} onChange={e=>setName(e.target.value)} placeholder="Ví dụ: Chăm xe" /></label><button type="button" disabled={!name.trim()} onClick={()=>{onCreate(name);setName("");setCreating(false);}}>Thêm và chọn loại</button> <button type="button" onClick={()=>setCreating(false)}>Hủy</button></div>}
 </div>;
}
export function addEventCategory(document:PersonalAssistantDocument,eventId:string,name:string):PersonalAssistantDocument {
 const cleaned=name.normalize("NFC").trim().replace(/\s+/gu," ");
 if(!cleaned||cleaned.length>50)return document;
 const builtin=Object.entries(BUILTIN_EVENT_KINDS).find(([,label])=>normalizeCategoryName(label)===normalizeCategoryName(cleaned));
 const existing=document.categories?.find(category=>normalizeCategoryName(category.name)===normalizeCategoryName(cleaned));
 if(!builtin&&!existing&&(document.categories??[]).length>=30)return document;
 const category=existing??{id:crypto.randomUUID(),name:cleaned};
 return {...document,categories:builtin||existing?document.categories:[...(document.categories??[]),category],events:document.events.map(event=>event.id!==eventId?event:{...event,kind:builtin?builtin[0] as PersonalLifeEvent["kind"]:"OTHER",categoryId:builtin?undefined:category.id})};
}
export function CategoryManager({document,onChange}:{document:PersonalAssistantDocument;onChange:(document:PersonalAssistantDocument)=>void}) {
 return <details><summary>Quản lý loại riêng ({(document.categories??[]).length}/30)</summary><p>Đổi tên để cập nhật tất cả sự kiện. Xóa loại vẫn giữ sự kiện và chuyển về “Ngày khác”. Tên trùng chỉ cần dùng lại loại đã có.</p>{(document.categories??[]).map(category=><div key={category.id}><label>Tên loại {category.name}<input maxLength={50} value={category.name} onChange={e=>onChange({...document,categories:document.categories?.map(item=>item.id===category.id?{...item,name:e.target.value}:item)})} /></label><button type="button" onClick={()=>onChange({...document,categories:document.categories?.filter(item=>item.id!==category.id),events:document.events.map(event=>event.categoryId===category.id?{...event,kind:"OTHER",categoryId:undefined}:event)})}>Xóa loại {category.name}</button></div>)}</details>;
}

/** Bounded title hints only; never creates categories or calls an AI provider. */
export function suggestEventCategory(title:string,document:PersonalAssistantDocument):string|undefined {
 const text=normalizeCategoryName(title);
 if(!text)return undefined;
 const custom=document.categories?.find(category=>text.includes(normalizeCategoryName(category.name)));
 if(custom)return custom.name;
 const rules:[RegExp,string][]=[
  [/sinh nhật|sinh nhat/u,'Sinh nhật'],[/ngày giỗ|ngay gio|giỗ /u,'Ngày giỗ'],
  [/gia hạn|gia han|hết hạn|het han/u,'Gia hạn'],[/kỷ niệm|ky niem|ngày cưới|ngay cuoi/u,'Kỷ niệm'],
  [/thay nhớt|thay nhot|bảo dưỡng xe|bao duong xe|đăng kiểm|dang kiem/u,'Chăm xe'],
  [/khám bệnh|kham benh|tái khám|tai kham|khám sức khỏe|kham suc khoe/u,'Sức khỏe'],
 ];
 return rules.find(([pattern])=>pattern.test(text))?.[1];
}
