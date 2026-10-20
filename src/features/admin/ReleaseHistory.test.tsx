import {act,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {ReleaseHistory} from './ReleaseHistory';
import {releaseCatalog} from '@/modules/releases/catalog';
const first='5479e5bc-6cd0-4628-b7ca-8f249cfc0ef9',second='788420ea-c791-4a12-ade6-e512f709a27e';
const tag='a'.repeat(40);
it('labels the responding production version separately from test scope and promotion time',async()=>{
 const fetch=vi.fn(async(_input:unknown)=>new Response(JSON.stringify({data:{readerId:'owner',catalog:releaseCatalog,runtime:{status:'SERVING',versionId:first,tag}}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 render(<ReleaseHistory/>);
 expect(await screen.findByText('Đang phục vụ production')).toBeVisible();expect(screen.getByText(first)).toBeVisible();
 expect(fetch.mock.calls[0][0]).toBe('/api/product-updates/runtime');
 expect(screen.getByRole('link',{name:'Xem commit aaaaaaa'})).toHaveAttribute('href',`https://github.com/nguyenxtan/calenote/commit/${tag}`);
 expect(screen.queryByText(/Chưa phát hành bản này/)).not.toBeInTheDocument();
});
it('updates on next response and rollback, and stops claiming current status after a refresh failure',async()=>{
 let id=first,offline=false;
 vi.stubGlobal('fetch',vi.fn(async()=>{if(offline)throw Error('offline');return new Response(JSON.stringify({data:{readerId:'owner',catalog:releaseCatalog,runtime:{status:'SERVING',versionId:id,tag:null}}}),{headers:{'content-type':'application/json'}});}));
 render(<ReleaseHistory/>);await screen.findByText(first);
 id=second;act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText(second);expect(screen.queryByText(first)).not.toBeInTheDocument();
 id=first;act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText(first);
 offline=true;act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(screen.queryByText('Đang phục vụ production')).not.toBeInTheDocument());
 expect(screen.getByText('Chưa xác định trạng thái phát hành')).toBeVisible();expect(screen.getByText(/lần tải gần nhất/)).toBeVisible();
});
it.each([undefined,{status:'UNKNOWN'},{status:'NON_PRODUCTION'}])('does not infer deployment from missing or nonproduction metadata: %j',async(runtime)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{readerId:'owner',catalog:releaseCatalog,...runtime?{runtime}:{}}}),{headers:{'content-type':'application/json'}})));
 render(<ReleaseHistory/>);await screen.findByRole('heading',{name:releaseCatalog.notes[0].title});
 expect(screen.queryByText('Đang phục vụ production')).not.toBeInTheDocument();
 expect(screen.getByText(runtime?.status==='NON_PRODUCTION'?'Môi trường thử nghiệm':'Chưa xác định trạng thái phát hành')).toBeVisible();
});
