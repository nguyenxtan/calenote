/** Versioned scoped syntax codec. No semantic defaults, inference or global text replacement. */
type Row=Record<string,unknown>;
type Scope=keyof typeof COMPACT_KEYS;
export const COMPACT_KEYS={
 root:{operation:'o',changes:'c',query:'q',uncertainties:'u',directive:'g',reply:'r',texts:'x',integers:'n',dates:'d',clocks:'k',periods:'p'},
 operation:{code:'c',targetEvidence:'e'},
 fields:{title:'a',location:'b',notes:'c',eventDate:'d',eventTime:'e',reminderDate:'f',reminderTime:'g',calendar:'h',frequency:'i',occurrenceCount:'j',eventRelation:'k',leadOffsetDays:'l',endDate:'m'},
 change:{rank:'r',operation:'o',value:'v',text:'t',date:'d',evidence:'e',clock:'k'},
 query:{period:'p',date:'d',outputCalendar:'c',topic:'t',evidence:'e'},
 uncertainty:{fieldCode:'f',reason:'r',alternatives:'a'},
 alternative:{value:'v',text:'t',date:'d',period:'p',evidence:'e',clock:'k'},
 date:{kind:'k',calendar:'c',day:'d',month:'m',year:'y',leapMonth:'l',offsetDays:'o',weekday:'w',qualifier:'q'},
 period:{kind:'k',date:'d',from:'f',through:'t',unsupportedKind:'u'},
 clock:{hour:'h',minute:'m',qualifier:'q'},
 directive:{kind:'k',field:'f',reason:'r',issue:'i',topic:'t'},reply:{text:'t'},
} as const;
export const COMPACT_ENUMS={
 mutation:{SET:'s',REPLACE:'r',CLEAR:'c'},date:{CIVIL_DATE:'c',RELATIVE_DAY:'r',WEEKDAY:'w'},
 calendar:{GREGORIAN:'g',LUNAR_VN:'l'},weekday:{THIS_WEEK:'t',NEXT_WEEK:'n',UNRESOLVED:'u'},
 clock:{H24:'h',AM:'a',PM:'p',UNKNOWN:'u'},frequency:{ONCE:'o',DAILY:'d',WEEKLY:'w',MONTHLY:'m',YEARLY:'y',UNKNOWN:'u'},
 relation:{BEFORE_EVENT:'b',INCLUDING_EVENT:'i',STARTING_ON:'s'},
 reason:{MISSING:'m',AMBIGUOUS:'a',CONFLICT:'c',UNSUPPORTED_COMBINATION:'u'},
 period:{DAY:'d',WEEK_PREVIOUS:'wp',WEEK_CURRENT:'wc',WEEK_NEXT:'wn',MONTH_PREVIOUS:'mp',MONTH_CURRENT:'mc',MONTH_NEXT:'mn',WEEKEND_PREVIOUS:'ep',WEEKEND_CURRENT:'ec',WEEKEND_NEXT:'en',REST_OF_MONTH:'r',NEXT_7_DAYS:'n',UPCOMING:'u',DATE_BOUNDS:'b',UNSUPPORTED:'x'},
} as const;
const record=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
function check(valid:unknown):asserts valid {if(!valid)throw Error('COMPACT_SHAPE_INVALID');}
function invert(map:Readonly<Record<string,string>>){check(new Set(Object.values(map)).size===Object.keys(map).length);return Object.fromEntries(Object.entries(map).map(([key,value])=>[value,key]));}
for(const map of [...Object.values(COMPACT_KEYS),...Object.values(COMPACT_ENUMS)])invert(map);
function child(scope:Scope,key:string):Scope {
 if(scope==='root'){const scopes:Record<string,Scope>={operation:'operation',changes:'fields',query:'query',uncertainties:'uncertainty',directive:'directive',reply:'reply',dates:'date',clocks:'clock',periods:'period'};return scopes[key]??scope;}
 if(scope==='fields')return 'change';
 if(key==='date'||scope==='period'&&(key==='from'||key==='through'))return 'date';
 if(key==='period')return 'period';
 if(key==='clock')return 'clock';
 if(scope==='uncertainty'&&key==='alternatives')return 'alternative';
 return scope;
}
function enumMap(scope:Scope,key:string,field?:string):Readonly<Record<string,string>>|undefined {
 if(scope==='change'&&key==='operation')return COMPACT_ENUMS.mutation;
 if(scope==='change'&&key==='text'){if(field==='frequency')return COMPACT_ENUMS.frequency;if(field==='calendar')return COMPACT_ENUMS.calendar;if(field==='eventRelation')return COMPACT_ENUMS.relation;}
 if(scope==='date'){if(key==='kind')return COMPACT_ENUMS.date;if(key==='calendar')return COMPACT_ENUMS.calendar;if(key==='qualifier')return COMPACT_ENUMS.weekday;}
 if(scope==='period'&&key==='kind')return COMPACT_ENUMS.period;
 if(scope==='clock'&&key==='qualifier')return COMPACT_ENUMS.clock;
 if(scope==='query'&&key==='outputCalendar')return COMPACT_ENUMS.calendar;
 if(scope==='uncertainty'&&key==='reason')return COMPACT_ENUMS.reason;
 return undefined;
}
interface Node {schema:Row;pack:(value:unknown)=>unknown;unpack:(value:unknown)=>unknown;signature:string}
/** The source schema and scoped descriptor compile schema,forward and inverse together. */
export function compileCompactContext(source:unknown){
 const compile=(schema:unknown,scope:Scope,key='',field?:string):Node=>{
  check(record(schema));
  if(Array.isArray(schema.anyOf)){
   const nodes=schema.anyOf.map(branch=>compile(branch,scope,key,field));check(scope==='operation'&&nodes.length>0);
   const transform=(value:unknown,forward:boolean)=>{const results:unknown[]=[];for(const node of nodes){try{results.push((forward?node.pack:node.unpack)(value));}catch{/* An exact disjoint operation branch may refuse. */}}check(results.length===1);return results[0];};
   return {schema:{...schema,anyOf:nodes.map(n=>n.schema)},pack:v=>transform(v,true),unpack:v=>transform(v,false),signature:'operation-union'};
  }
  if(schema.type==='object'){
   check(record(schema.properties)&&Array.isArray(schema.required));
   const names=COMPACT_KEYS[scope] as Readonly<Record<string,string>>;
   const entries=Object.entries(schema.properties).map(([name,value])=>{check(Object.hasOwn(names,name));return {name,alias:names[name],node:compile(value,child(scope,name),name,scope==='fields'?name:field)};});
   check(new Set(entries.map(e=>e.alias)).size===entries.length&&schema.required.length===entries.length&&schema.required.every(name=>typeof name==='string'&&Object.hasOwn(schema.properties as Row,name)));
   const transform=(value:unknown,forward:boolean)=>{check(record(value));const from=entries.map(e=>forward?e.name:e.alias);check(Object.keys(value).length===entries.length&&from.every(name=>Object.hasOwn(value,name)));return Object.fromEntries(entries.map(e=>[forward?e.alias:e.name,(forward?e.node.pack:e.node.unpack)(value[forward?e.name:e.alias])]));};
   return {schema:{...schema,properties:Object.fromEntries(entries.map(e=>[e.alias,e.node.schema])),required:entries.map(e=>e.alias)},pack:v=>transform(v,true),unpack:v=>transform(v,false),signature:JSON.stringify(entries.map(e=>[e.name,e.alias,e.node.signature]))};
  }
  if(schema.type==='array'){
   if(schema.maxItems===0){const transform=(value:unknown)=>{check(Array.isArray(value)&&value.length===0);return [];};return {schema:{...schema,items:{type:'string'}},pack:transform,unpack:transform,signature:'empty-array'};}
   const node=compile(schema.items,scope,key,field);
   const transform=(value:unknown,forward:boolean)=>{check(Array.isArray(value));return value.map(forward?node.pack:node.unpack);};
   return {schema:{...schema,items:node.schema},pack:v=>transform(v,true),unpack:v=>transform(v,false),signature:`array:${node.signature}`};
  }
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const nullable=types.includes('null'),active=types.filter(type=>type!=='null');check(active.length<=1);
  const nullOnly=active.length===0;check(nullOnly||['string','integer','number','boolean'].includes(active[0] as string));
  const aliases=Array.isArray(schema.enum)?enumMap(scope,key,field):undefined;
  const inverse=aliases?invert(aliases):undefined;
  const enums=Array.isArray(schema.enum)?schema.enum.filter(v=>v!==null):undefined;
  if(aliases)check(enums?.every(v=>typeof v==='string'&&Object.hasOwn(aliases,v)));
  const primitive:Row={...schema,type:nullOnly?'string':active[0]};delete primitive.enum;
  if(enums)primitive.enum=enums.map(v=>aliases?aliases[v as string]:v);
  const scalar=(value:unknown,forward:boolean)=>{
   check(!nullOnly);const type=active[0];check(type==='integer'?typeof value==='number'&&Number.isSafeInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type);
   const translated=aliases?(forward?(typeof value==='string'&&Object.hasOwn(aliases,value)?aliases[value]:undefined):(typeof value==='string'&&Object.hasOwn(inverse!,value)?inverse![value]:undefined)):value;
   check(!enums||enums.includes(forward?value:translated));return translated;
  };
  if(nullable){const cell:Row={type:'array',items:primitive,...(nullOnly?{maxItems:0}:{})};return {schema:cell,pack:v=>v===null?[]:[scalar(v,true)],unpack:v=>{check(Array.isArray(v)&&v.length<=1&&(!nullOnly||v.length===0));return v.length===0?null:scalar(v[0],false);},signature:`cell:${nullOnly?'null':active[0]}:${JSON.stringify(aliases??{})}`};}
  return {schema:primitive,pack:v=>scalar(v,true),unpack:v=>scalar(v,false),signature:`scalar:${active[0]}:${JSON.stringify(aliases??{})}`};
 };
 return compile(source,'root');
}
