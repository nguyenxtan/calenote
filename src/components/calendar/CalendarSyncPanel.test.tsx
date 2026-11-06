import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CalendarSyncPanel, type GoogleCodeApi } from './CalendarSyncPanel';
it('shows the disabled truth without loading GIS or offering connect',async()=>{
 const request=vi.fn(async()=>Response.json({data:{available:false,state:'UNAVAILABLE',lastSyncedAt:null,error:null}}));const loadGoogle=vi.fn();
 render(<CalendarSyncPanel request={request} loadGoogle={loadGoogle}/>);
 expect(await screen.findByText(/Đồng bộ tự động chưa khả dụng/u)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Kết nối Google Calendar'})).not.toBeInTheDocument();expect(loadGoogle).not.toHaveBeenCalled();
 expect(screen.getByText(/Không gửi ghi chú/u)).toBeInTheDocument();
});
it('prepares a nonce then starts popup on a separate user click and posts code in the body',async()=>{
 const request=vi.fn(async(url:RequestInfo|URL)=>{
  if(String(url).endsWith('/begin'))return Response.json({data:{nonce:'one-time-fixture',clientId:'public-fixture',expiresAt:Date.now()+300000}});
  if(String(url).endsWith('/code'))return Response.json({data:{state:'PENDING'}});
  return Response.json({data:{available:true,state:request.mock.calls.some(([u])=>String(u).endsWith('/code'))?'PENDING':'NOT_CONNECTED',lastSyncedAt:null,error:null}});
 });
 let callback!: (response:{code?:string;error?:string})=>void;const requestCode=vi.fn();const api:GoogleCodeApi={initCodeClient:vi.fn(config=>{callback=config.callback;return {requestCode};})};
 const loadGoogle=vi.fn(async()=>api);render(<CalendarSyncPanel request={request} loadGoogle={loadGoogle}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Kết nối Google Calendar'}));
 fireEvent.click(await screen.findByRole('button',{name:'Tiếp tục với Google'}));expect(requestCode).toHaveBeenCalledTimes(1);
 expect(api.initCodeClient).toHaveBeenCalledWith(expect.objectContaining({scope:'https://www.googleapis.com/auth/calendar.app.created',include_granted_scopes:false,ux_mode:'popup'}));
 callback({code:'authorization-fixture'});
 await waitFor(()=>expect(request).toHaveBeenCalledWith('/api/calendar/sync/code',expect.objectContaining({method:'POST',body:JSON.stringify({nonce:'one-time-fixture',code:'authorization-fixture'}),headers:expect.objectContaining({'x-requested-with':'XmlHttpRequest'})})));
 expect(document.location.href).not.toContain('authorization-fixture');
});
it('disconnects with keep-remote copy and explains failed provider revocation',async()=>{
 const request=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/disconnect')?Response.json({data:{disconnected:true,remoteEventsKept:true,revocation:'FAILED'}}):Response.json({data:{available:true,state:'ACTIVE',lastSyncedAt:1,error:null}}));
 render(<CalendarSyncPanel request={request} loadGoogle={vi.fn()}/>);
 expect(await screen.findByText(/Ngắt kết nối giữ nguyên/u)).toBeInTheDocument();fireEvent.click(await screen.findByRole('button',{name:'Ngắt kết nối Google Calendar'}));
 expect(await screen.findByRole('link',{name:'Thu hồi quyền trong Google'})).toHaveAttribute('href','https://myaccount.google.com/permissions');
});
