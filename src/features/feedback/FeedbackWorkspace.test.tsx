import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import type {ReactNode} from 'react';
import {FeedbackWorkspace} from './FeedbackWorkspace';
const replace=vi.fn();vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));vi.mock('@/ui/shell/AppShell',()=>({AppShell:({children}:{children:ReactNode})=><>{children}</>}));
const json=(data:unknown)=>new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}});
let reader='A',requests:{method:string;body:unknown}[];
beforeEach(()=>{reader='A';requests=[];replace.mockClear();vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
 if(path==='/api/session')return json({user:{email:reader+'@example.test',displayName:reader,timezone:'Asia/Ho_Chi_Minh'}});
 if(init?.method==='POST'){requests.push({method:'POST',body:JSON.parse(String(init.body))});throw Error('Unknown outcome');}
 return json({readerId:reader.repeat(43),items:[],next:null});
}));});
it('revalidates shared-cookie identity on return, clears old draft/id without same-window event',async()=>{
 render(<FeedbackWorkspace/>);await screen.findByLabelText('Tiêu đề');fireEvent.change(screen.getByLabelText('Tiêu đề'),{target:{value:'Nội dung riêng của A'}});fireEvent.change(screen.getByLabelText('Mô tả'),{target:{value:'Mô tả riêng tư của tài khoản A trước khi đổi.'}});fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));await screen.findByRole('alert');
 reader='B';act(()=>window.dispatchEvent(new Event('blur')));act(()=>window.dispatchEvent(new Event('focus')));
 await screen.findByLabelText('Tiêu đề');expect(screen.getByLabelText('Tiêu đề')).toHaveValue('');expect(screen.queryByRole('button',{name:'Kiểm tra / gửi lại cùng mã'})).not.toBeInTheDocument();expect(requests).toHaveLength(1);
});
it('preserves same-owner RAM draft across focus revalidation but never auto-replays POST',async()=>{
 render(<FeedbackWorkspace/>);await screen.findByLabelText('Tiêu đề');fireEvent.change(screen.getByLabelText('Tiêu đề'),{target:{value:'Giữ bản nháp cùng owner'}});act(()=>window.dispatchEvent(new Event('blur')));act(()=>window.dispatchEvent(new Event('focus')));
 await screen.findByRole('heading',{name:'Góp ý & báo lỗi',level:1});expect(screen.getByLabelText('Tiêu đề')).toHaveValue('Giữ bản nháp cùng owner');expect(requests).toHaveLength(0);
});
