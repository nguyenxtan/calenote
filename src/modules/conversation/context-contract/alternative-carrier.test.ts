// @vitest-environment node
import {expect,it} from "vitest";
import {harness,proposal} from "./service-test-support";
import {UncertaintyV3Schema,type ContextInput} from "./contracts";
it("wire75 canonical candidates preserve every reason and nullable inner operands",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"8h",occurrence:1}],value={hour:8,minute:0,qualifier:"H24"};
 for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){
  expect(UncertaintyV3Schema.safeParse({field:"reminderTime",reason,alternatives:[{value,evidence}]}).success).toBe(true);
  expect(UncertaintyV3Schema.safeParse({field:"reminderTime",reason,alternatives:[{value:null,evidence}]}).success).toBe(false);
 }
 expect(UncertaintyV3Schema.safeParse({field:"reminderTime",reason:"MISSING",alternatives:[]}).success).toBe(true);
 expect(UncertaintyV3Schema.safeParse({field:"queryRange",reason:"MISSING",alternatives:[{value:{kind:"DAY",date:null},evidence}]}).success).toBe(true);
});
it.each(["empty","typed","null"])("wire75 actual null candidate remains atomic: %s",async mode=>{
 const base=proposal({title:"gọi mẹ"});
 const h=await harness([input=>({...base(input) as object,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:mode==="empty"?[]:[{value:{hour:8,minute:0,qualifier:"H24"},evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]}]}]})],wire=>{
  if(mode==="null"){const raw=wire as {uncertainties:Array<{alternatives:string[]}>};const alt=JSON.parse(raw.uncertainties[0].alternatives[0]);alt.value=null;raw.uncertainties[0].alternatives[0]=JSON.stringify(alt);}return wire;
 });
 await h.turn(0,"nhắc gọi mẹ lúc 8h");
 if(mode==="null"){expect(await h.read(1)).toBeNull();expect(h.events).toContainEqual(expect.objectContaining({event:"POST_CANONICAL_STAGE",diagnostic:expect.objectContaining({stage:"CANONICAL",result:"REJECTED",reason:"SCHEMA_INVALID"})}));}
 else expect(await h.read(1)).not.toBeNull();
 expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);
});
it.each(["valid","old-array","unknown-code"])("wire59 actual service alternative carrier is atomic: %s",async mode=>{
 const base=proposal({title:"gọi mẹ"});
 const h=await harness([(input:ContextInput)=>({...base(input) as object,uncertainties:[{field:"notes",reason:"AMBIGUOUS",alternatives:[{value:"mang giấy tờ",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]}]}]})],wire=>{
  const raw=wire as {uncertainties:Array<{alternatives:string[]}>};
  if(mode!=="valid"){const alternative=JSON.parse(raw.uncertainties[0].alternatives[0]);alternative.evidence=mode==="old-array"?[{kind:"USER_TURN",turn:0}]:{primaryEvidence:"PRIVATE_UNAVAILABLE_CODE",additionalEvidenceJson:"[]"};raw.uncertainties[0].alternatives[0]=JSON.stringify(alternative);}
  return wire;
 });
 await h.turn(0,"nhắc gọi mẹ mang giấy tờ");
 if(mode==="valid")expect(await h.read(1)).not.toBeNull();
 else {expect(await h.read(1)).toBeNull();expect(h.events).toContainEqual(expect.objectContaining({event:"POST_CANONICAL_STAGE",diagnostic:expect.objectContaining({result:"REJECTED"})}));expect(JSON.stringify(h.events)).not.toContain("PRIVATE_UNAVAILABLE_CODE");}
 expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);expect(h.inputs).toHaveLength(1);expect(h.replies).toHaveLength(1);
});
