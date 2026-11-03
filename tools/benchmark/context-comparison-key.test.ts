// @vitest-environment node
import {expect,it} from 'vitest';
import {admitComparisonKey} from './context-comparison-key';
const valid={is_provisioning_key:false,limit:.75,limit_remaining:.5,limit_reset:null,include_byok_in_limit:true};
it('requires a lifetime inference cap that includes BYOK billing',()=>{
 expect(admitComparisonKey(valid)).toEqual({limit:.75,remaining:.5});
 for(const patch of [{is_provisioning_key:true},{is_provisioning_key:undefined},{limit_reset:'daily'},{limit_reset:undefined},{include_byok_in_limit:false},{include_byok_in_limit:undefined},{limit:1.01},{limit:null},{limit_remaining:.1},{limit_remaining:Infinity}])expect(()=>admitComparisonKey({...valid,...patch})).toThrow('CAPPED_INFERENCE_KEY_REQUIRED');
});
it('validates the selected route reservation independently of key policy',()=>{
 expect(admitComparisonKey({...valid,limit_remaining:.1},.08384)).toEqual({limit:.75,remaining:.1});
 for(const reserve of [NaN,Infinity,-1,0])expect(()=>admitComparisonKey(valid,reserve)).toThrow('CAPPED_INFERENCE_KEY_REQUIRED');
});
it('admits the owner-approved USD2 lifetime ceiling only when explicitly selected',()=>{
 const raised={...valid,limit:2,limit_remaining:1.2};
 expect(()=>admitComparisonKey(raised)).toThrow('CAPPED_INFERENCE_KEY_REQUIRED');
 expect(admitComparisonKey(raised,.116759,2)).toEqual({limit:2,remaining:1.2});
 for(const ceiling of [0,1.5,2.01,Infinity,NaN])expect(()=>admitComparisonKey(raised,.116759,ceiling)).toThrow('CAPPED_INFERENCE_KEY_REQUIRED');
 for(const patch of [{limit:2.01},{limit_reset:'daily'},{include_byok_in_limit:false},{is_provisioning_key:true}])expect(()=>admitComparisonKey({...raised,...patch},.116759,2)).toThrow('CAPPED_INFERENCE_KEY_REQUIRED');
});
