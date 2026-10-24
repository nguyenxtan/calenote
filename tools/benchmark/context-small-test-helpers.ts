import type { SmallContextWire, SmallChangeCarrier } from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
/** Test authoring only: never used to decode or repair provider data. */
export function changeEntries(wire: SmallContextWire) {
 return Object.entries(wire.changes).flatMap(([field,carrier])=>carrier===null?[]:[{field,...carrier}]).sort((a,b)=>a.rank-b.rank);
}
export function changeAt(wire: SmallContextWire,index: number): SmallChangeCarrier {
 return wire.changes[changeEntries(wire)[index].field]!;
}
export function replaceChanges(wire: SmallContextWire,rows: Array<SmallChangeCarrier&{field:string}>) {
 wire.changes=Object.fromEntries(Object.keys(wire.changes).map(field=>[field,null]));
 for(const {field,...carrier}of rows){if(wire.changes[field])throw Error('DUPLICATE_TEST_FIELD');wire.changes[field]=carrier;}
}
