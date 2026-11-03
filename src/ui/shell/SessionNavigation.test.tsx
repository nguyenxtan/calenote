import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { useState } from 'react';
import { SessionNavigationProvider, useSessionLoader } from './SessionNavigation';
const user={email:'owner@example.com',displayName:'Owner',timezone:'Asia/Ho_Chi_Minh'};
function Page(){const load=useSessionLoader();const [name,setName]=useState('');return <button onClick={()=>void load().then(u=>setName(u.displayName))}>{name||'Load'}</button>}
it('reuses verified session across page remounts and invalidates on account change',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{user}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 function Routes(){const [route,setRoute]=useState(0);return <SessionNavigationProvider><button onClick={()=>setRoute(n=>n+1)}>Navigate</button><Page key={route}/></SessionNavigationProvider>}
 render(<Routes/>);fireEvent.click(screen.getByText('Load'));await screen.findByText('Owner');
 fireEvent.click(screen.getByText('Navigate'));fireEvent.click(screen.getByText('Load'));await screen.findByText('Owner');expect(fetcher).toHaveBeenCalledTimes(1);
 act(()=>window.dispatchEvent(new Event('calenote-session-changed')));
 fireEvent.click(screen.getByText('Navigate'));fireEvent.click(screen.getByText('Load'));await screen.findByText('Owner');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('deduplicates concurrent session reads and never caches a rejected session',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'UNAUTHENTICATED'}}),{status:401,headers:{'content-type':'application/json'}})).mockImplementation(async()=>new Response(JSON.stringify({data:{user}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 function Probe(){const load=useSessionLoader();const [status,setStatus]=useState('Try');return <button onClick={()=>void Promise.all([load(),load()]).then(()=>setStatus('Ready')).catch(()=>setStatus('Retry'))}>{status}</button>}
 render(<SessionNavigationProvider><Probe/></SessionNavigationProvider>);fireEvent.click(screen.getByText('Try'));await screen.findByText('Retry');expect(fetcher).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByText('Retry'));await waitFor(()=>expect(screen.getByText('Ready')).toBeVisible());expect(fetcher).toHaveBeenCalledTimes(2);
});
it('revalidates after the short memory lifetime',async()=>{
 let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{user}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 render(<SessionNavigationProvider><Page/></SessionNavigationProvider>);fireEvent.click(screen.getByText('Load'));await screen.findByText('Owner');
 now+=15_001;fireEvent.click(screen.getByText('Owner'));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
});
it('does not treat hiding a tab during session validation as logout',async()=>{
 let finish:((response:Response)=>void)|undefined;
 const json=()=>new Response(JSON.stringify({data:{user}}),{headers:{'content-type':'application/json'}});
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve})).mockImplementation(async()=>json());vi.stubGlobal('fetch',fetcher);
 const unauthorized=vi.fn();
 function Probe(){const load=useSessionLoader();const [name,setName]=useState('Load');return <button onClick={()=>void load(unauthorized).then(u=>setName(u.displayName))}>{name}</button>}
 render(<SessionNavigationProvider><Probe/></SessionNavigationProvider>);fireEvent.click(screen.getByText('Load'));
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await act(async()=>{finish!(json())});await screen.findByText('Owner');expect(unauthorized).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
});
