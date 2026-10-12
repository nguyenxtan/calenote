import {it,expect} from "vitest";
import {unwrapSingletonAuthoringFixture,wrapSingletonAuthoringFixture,typedSingletonSchemaFixture} from "./context-singleton-json.test-support";
import {googleLiteEuContextWireSchemaV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
it("explicit singleton authoring view is lossless for payload source rank order and malformed raw controls",()=>{
 const wire={changes:[{rank:2,change:{field:"notes",operation:"SET",value:"literal",evidence:{primaryEvidence:"U0",additionalEvidenceJson:"[]"}}}],titleChange:{rank:10,change:JSON.stringify({field:"title",operation:"SET",value:'literal "{}"',evidence:{primaryEvidence:"U0",additionalEvidenceJson:"[]"}})},locationChange:null};
 const bytes=JSON.stringify(wire);expect(wrapSingletonAuthoringFixture(unwrapSingletonAuthoringFixture(wire))).toEqual(wire);expect(JSON.stringify(wire)).toBe(bytes);
 for(const change of [NaN,Infinity,-0,undefined,{value:NaN},{value:-0}]){const bad={titleChange:{rank:0,change,extra:true}};expect(wrapSingletonAuthoringFixture(bad)).toBe(bad);}
 let calls=0;const wrapper={rank:0,change:{field:"title",value:"x"}};Object.defineProperty(wrapper.change,"value",{enumerable:true,get(){calls++;return "SECRET"}});const bad={titleChange:wrapper};expect(wrapSingletonAuthoringFixture(bad)).toBe(bad);expect(calls).toBe(0);
 const extra={titleChange:{rank:0,change:{field:"title"},extra:true}};expect(wrapSingletonAuthoringFixture(extra).titleChange.extra).toBe(true);
});
it("synchronous public typed schema capture preserves original roots while outgoing language is string",()=>{
 const typed=typedSingletonSchemaFixture().schema,outgoing=googleLiteEuContextWireSchemaV3().schema;
 expect(typed.properties!.titleChange).not.toEqual(outgoing.properties!.titleChange);expect(typed.$defs).toEqual(outgoing.$defs);
});
