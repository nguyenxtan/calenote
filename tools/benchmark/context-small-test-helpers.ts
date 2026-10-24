import type { SmallContextWire, SmallChangeCarrier } from '../../src/modules/intelligence/infrastructure/openrouter/context-small-intermediate';
/** Test authoring only: never used to decode or repair provider data. */
export function changeEntries(wire: SmallContextWire) {
 return Object.entries(wire.changes).flatMap(([field,carrier])=>carrier.operation==='KEEP'?[]:[{field,...carrier,rank:carrier.rank as number}]).sort((a,b)=>a.rank-b.rank);
}
export function changeAt(wire: SmallContextWire,index: number): SmallChangeCarrier {
 return wire.changes[changeEntries(wire)[index].field]!;
}
export function replaceChanges(wire: SmallContextWire,rows: Array<SmallChangeCarrier&{field:string}>) {
 wire.changes=Object.fromEntries(Object.keys(wire.changes).map(field=>[field,{rank:null,operation:'KEEP',value:null,text:null,date:[],evidence:[]}]));
 for(const {field,...carrier}of rows){if(wire.changes[field]&&wire.changes[field].operation!=='KEEP')throw Error('DUPLICATE_TEST_FIELD');wire.changes[field]=carrier;}
}
/** Explicit authoring of inert date syntax padding, never a model repair. */
export function paddedDate(value: Record<string,unknown>) {
 return {calendar:null,day:null,month:null,year:null,leapMonth:null,offsetDays:null,weekday:null,qualifier:null,...value};
}
