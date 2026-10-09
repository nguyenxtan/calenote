// @vitest-environment node
import {expect,it} from "vitest";
import {harness,proposal} from "./service-test-support";
import type {ContextInput} from "./contracts";
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
