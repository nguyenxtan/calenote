// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { calendarSyncCapability, GOOGLE_CALENDAR_SCOPE } from './contracts';
import { GoogleCalendarProvider, CalendarProviderError, base32Hex } from './google-provider';

afterEach(() => vi.unstubAllGlobals());
const config = { clientId:'fixture.apps.googleusercontent.com', clientSecret:'fixture-client-value', appOrigin:'https://calenote.example' };
const tokenPayload = {access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_CALENDAR_SCOPE};
it('requires the flag and both fields without touching global fetch', () => {
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 expect(calendarSyncCapability({})).toEqual({available:false});
 expect(calendarSyncCapability({CALENDAR_SYNC_ENABLED:'true',GOOGLE_CALENDAR_CLIENT_ID:config.clientId})).toEqual({available:false});
 expect(calendarSyncCapability({CALENDAR_SYNC_ENABLED:'false',GOOGLE_CALENDAR_CLIENT_ID:config.clientId,GOOGLE_CALENDAR_CLIENT_SECRET:config.clientSecret})).toEqual({available:false});
 expect(calendarSyncCapability({CALENDAR_SYNC_ENABLED:'true',GOOGLE_CALENDAR_CLIENT_ID:config.clientId,GOOGLE_CALENDAR_CLIENT_SECRET:config.clientSecret})).toEqual({available:true,clientId:config.clientId});
 expect(fetch).not.toHaveBeenCalled();
});
it('posts code, refresh and revoke secrets in bodies with no secret-bearing URL',async()=>{
 const transport=vi.fn().mockImplementation(async()=>Response.json(tokenPayload));
 const p=new GoogleCalendarProvider(config,transport);
 const tokens=await p.exchangeCode('fixture-code',1000);
 expect(tokens).toEqual({accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:3601000});
 let [url,init]=transport.mock.calls[0];expect(url).toBe('https://oauth2.googleapis.com/token');
 expect(init.method).toBe('POST');expect(new URLSearchParams(init.body).get('redirect_uri')).toBe(config.appOrigin);
 expect(new URLSearchParams(init.body).get('client_secret')).toBe(config.clientSecret);
 expect(new URLSearchParams(init.body).get('code')).toBe('fixture-code');
 expect(init.redirect).toBe('manual');expect(init.signal).toBeInstanceOf(AbortSignal);
 await p.refresh('fixture-refresh',1000);expect(new URLSearchParams(transport.mock.calls[1][1].body).get('grant_type')).toBe('refresh_token');
 transport.mockResolvedValueOnce(new Response(null,{status:200}));await p.revoke('fixture-refresh');
 [url,init]=transport.mock.calls[2];expect(url).toBe('https://oauth2.googleapis.com/revoke');expect(init.body).toBe('token=fixture-refresh');
 expect(transport.mock.calls.every(([u])=>!String(u).includes('fixture-'))).toBe(true);
});
it('rejects insufficient grants and classifies retry/auth/unknown errors without provider messages',async()=>{
 const transport=vi.fn().mockResolvedValue(Response.json({...tokenPayload,scope:'openid'}));const p=new GoogleCalendarProvider(config,transport);
 await expect(p.exchangeCode('code',0)).rejects.toMatchObject({kind:'REAUTH_REQUIRED'});
 transport.mockResolvedValueOnce(Response.json({error:'invalid_grant',description:'private raw error'},{status:400}));
 await expect(p.refresh('r',0)).rejects.toMatchObject({kind:'REAUTH_REQUIRED'});
 transport.mockResolvedValueOnce(new Response('quota',{status:429,headers:{'retry-after':'999999'}}));
 await expect(p.createCalendar('a')).rejects.toMatchObject({kind:'RETRYABLE',retryAfterMs:3600000});
 transport.mockRejectedValueOnce(new Error('private token details'));
 await expect(p.createCalendar('a')).rejects.toEqual(new CalendarProviderError('UNKNOWN'));
});
it('uses Google-valid base32hex and strips notes/location/attendees from managed event payloads',async()=>{
 expect(base32Hex(new Uint8Array([255,0]))).toBe('vs00');
 const transport=vi.fn().mockImplementation(async()=>Response.json({id:'cn01234',extendedProperties:{private:{calenote:'cn01234'}}}));
 const p=new GoogleCalendarProvider(config,transport);
 await p.insertEvent('a','calendar@example','cn01234',{uid:'logical',title:'Họp',start:{kind:'UTC',timestamp:0},status:'CONFIRMED'});
 const [url,init]=transport.mock.calls[0];expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/calendar%40example/events');
 expect(JSON.parse(init.body)).toEqual({id:'cn01234',status:'confirmed',summary:'Họp',start:{dateTime:'1970-01-01T00:00:00.000Z'},end:{dateTime:'1970-01-01T00:01:00.000Z'},transparency:'transparent',reminders:{useDefault:false},extendedProperties:{private:{calenote:'cn01234'}}});
 await p.updateEvent('a','cal','cn01234',{uid:'logical',title:'Ngày',start:{kind:'DATE',date:'2026-12-31'},status:'CONFIRMED'});
 expect(JSON.parse(transport.mock.calls[1][1].body).end).toEqual({date:'2027-01-01'});
});
it('checks opaque remote ownership before accepting a deterministic event id',async()=>{
 const transport=vi.fn().mockResolvedValue(Response.json({id:'cn01234',extendedProperties:{private:{calenote:'foreign'}}}));const p=new GoogleCalendarProvider(config,transport);
 await expect(p.getEvent('a','cal','cn01234')).rejects.toMatchObject({kind:'OWNERSHIP_CONFLICT'});
 transport.mockResolvedValueOnce(new Response(null,{status:404}));expect(await p.getEvent('a','cal','cn01234')).toBe(false);
 transport.mockResolvedValueOnce(new Response(null,{status:410}));await p.removeEvent('a','cal','cn01234');
});
it('bounds malformed and oversized successful provider responses without leaking their contents',async()=>{
 const transport=vi.fn().mockResolvedValue(new Response('x'.repeat(65_537),{status:200}));const p=new GoogleCalendarProvider(config,transport);
 await expect(p.createCalendar('a')).rejects.toEqual(new CalendarProviderError('UNKNOWN'));
 transport.mockResolvedValueOnce(Response.json({error:{errors:[{reason:'rateLimitExceeded'}]}},{status:403}));await expect(p.createCalendar('a')).rejects.toMatchObject({kind:'RETRYABLE'});
});

it('rejects manual redirects as unknown without reading Location or following them',async()=>{
 const transport=vi.fn().mockResolvedValue(new Response(null,{status:307,headers:{location:'https://foreign.invalid/never-follow'}}));const p=new GoogleCalendarProvider(config,transport);
 await expect(p.createCalendar('fixture-access')).rejects.toMatchObject({kind:'UNKNOWN'});expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][1].redirect).toBe('manual');
});
it.each([404,410])('classifies update HTTP %s as a missing event for bounded recovery',async status=>{
 const p=new GoogleCalendarProvider(config,async()=>new Response(null,{status}));
 await expect(p.updateEvent('access','calendar','cn01234',{uid:'u',title:'Title',start:{kind:'UTC',timestamp:0},status:'CONFIRMED'})).rejects.toMatchObject({kind:'NOT_FOUND'});
});
it.each(['dailyLimitExceeded','forbiddenForNonOrganizer','unrecognizedReason'])('keeps non-auth 403 %s retryable without forcing reauthorization',async reason=>{
 const p=new GoogleCalendarProvider(config,async()=>Response.json({error:{errors:[{reason}]}},{status:403}));
 await expect(p.createCalendar('access')).rejects.toMatchObject({kind:'RETRYABLE'});
});
it.each(['authError','insufficientPermissions'])('requires reauthorization for explicit 403 %s',async reason=>{
 const p=new GoogleCalendarProvider(config,async()=>Response.json({error:{errors:[{reason}]}},{status:403}));
 await expect(p.createCalendar('access')).rejects.toMatchObject({kind:'REAUTH_REQUIRED'});
});
it('accepts an id-only cancelled tombstone only with original owned-mapping proof',async()=>{
 const transport=vi.fn().mockImplementation(async()=>Response.json({id:'cn01234',status:'cancelled'}));const p=new GoogleCalendarProvider(config,transport);
 await expect(p.getEvent('access','calendar','cn01234')).rejects.toMatchObject({kind:'OWNERSHIP_CONFLICT'});
 expect(await p.getEvent('access','calendar','cn01234',true)).toBe('DELETED');
 transport.mockResolvedValueOnce(Response.json({id:'cn01234',status:'cancelled',extendedProperties:{private:{calenote:'foreign'}}}));
 await expect(p.getEvent('access','calendar','cn01234',true)).rejects.toMatchObject({kind:'OWNERSHIP_CONFLICT'});
});
