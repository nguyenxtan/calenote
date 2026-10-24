import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import {FeedbackPanel} from './FeedbackPanel';
const id='fb_000000000001_00000000-0000-4000-8000-000000000001';
const ticket={id,kind:'BUG' as const,title:'Lịch bị lỗi',description:'Mở trang lịch nhưng không có dữ liệu.',page:null,status:'NEW' as const,revision:1,reply:'',disposition:null,createdAt:1,updatedAt:1};
const summary={id,kind:ticket.kind,title:ticket.title,status:ticket.status,revision:1,createdAt:1,updatedAt:1};
const initial={readerId:'A'.repeat(43),items:[summary],next:null};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(status>=400?{error:{code:'DENIED',message:'Denied'}}:{data}),{status,headers:{'content-type':'application/json'}});
let requests:{url:string;method:string;body:Record<string,unknown>|null}[];
beforeEach(()=>{requests=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const method=init?.method??'GET';requests.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});return json(method==='POST'||url.includes('/'+id)?ticket:initial);}));});
async function fill(){fireEvent.change(screen.getByLabelText('Tiêu đề'),{target:{value:'Lịch bị lỗi'}});fireEvent.change(screen.getByLabelText('Mô tả'),{target:{value:ticket.description}});}
it('submits once, validates durable receipt, lists and opens escaped detail',async()=>{
 render(<FeedbackPanel initial={initial} onAuthLost={()=>{}}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));
 expect(await screen.findByText(/Đã nhận yêu cầu/)).toHaveTextContent(id);expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);expect(screen.getByLabelText('Tiêu đề')).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'Lịch bị lỗi'}));expect(await screen.findByText(ticket.description)).toBeVisible();expect(screen.getByText('Chưa có phản hồi từ quản trị.')).toBeVisible();
});
it('unknown receipt keeps RAM draft and identical id/payload retry, no false success',async()=>{
 let sends=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{if(init?.method==='POST'){requests.push({url:_url,method:'POST',body:JSON.parse(String(init.body))});sends++;return sends===1?json({id}):json(ticket);}return json(initial);}));
 render(<FeedbackPanel initial={initial} onAuthLost={()=>{}}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));await screen.findByRole('alert');
 expect(screen.queryByText(/Đã nhận yêu cầu/)).not.toBeInTheDocument();expect(screen.getByLabelText('Tiêu đề')).toHaveValue('Lịch bị lỗi');
 expect(screen.getByLabelText('Tiêu đề')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Kiểm tra / gửi lại cùng mã'}));await screen.findByText(/Đã nhận yêu cầu/);expect(requests[0].body).toEqual(requests[1].body);
});
it.each([200,401,403,500])('account switch discards draft/detail/query and ignores late POST %s',async(status)=>{
 let resolve!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Promise<Response>(r=>{resolve=r;}):json(ticket)));
 const lost=vi.fn();const view=render(<FeedbackPanel initial={initial} onAuthLost={lost}/>);await fill();fireEvent.change(screen.getByLabelText('Lọc loại'),{target:{value:'FEATURE'}});fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));
 view.rerender(<FeedbackPanel initial={{...initial,readerId:'B'.repeat(43),items:[]}} onAuthLost={lost}/>);
 await act(async()=>{resolve(json(ticket,status));});
 expect(screen.getByLabelText('Tiêu đề')).toHaveValue('');expect(screen.getByLabelText('Lọc loại')).toHaveValue('');expect(screen.queryByText(/Đã nhận yêu cầu/)).not.toBeInTheDocument();expect(screen.queryByText(ticket.description)).not.toBeInTheDocument();expect(lost).not.toHaveBeenCalled();
});
it.each([401,403])('current auth loss clears private form/detail/list, old later response cannot restore (%s)',async(status)=>{
 const lost=vi.fn();render(<FeedbackPanel initial={initial} onAuthLost={lost}/>);await fill();vi.stubGlobal('fetch',vi.fn(async()=>json(null,status)));fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));await screen.findByText(/Phiên hoặc quyền truy cập đã thay đổi/);
 expect(screen.queryByLabelText('Tiêu đề')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Lịch bị lỗi'})).not.toBeInTheDocument();expect(lost).toHaveBeenCalledTimes(1);
});
it('session event wipes private state and ignores deferred GET success',async()=>{
 let resolve!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(async()=>new Promise<Response>(r=>{resolve=r;})));
 render(<FeedbackPanel initial={initial} onAuthLost={()=>{}}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));act(()=>window.dispatchEvent(new Event('calenote-session-changed')));await act(async()=>resolve(json(initial)));
 expect(screen.queryByLabelText('Tiêu đề')).not.toBeInTheDocument();expect(screen.queryByText('Lịch bị lỗi')).not.toBeInTheDocument();
});
it('admin reviews detail and sends expected revision, close result and reply',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const method=init?.method??'GET';requests.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});return json(method==='PATCH'?{...ticket,status:'CLOSED',revision:2,disposition:'RESOLVED',reply:'Đã sửa và kiểm tra.'}:url.includes('/'+id)?ticket:initial);}));
 render(<FeedbackPanel initial={initial} admin onAuthLost={()=>{}}/>);expect(screen.queryByLabelText('Tiêu đề')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Lịch bị lỗi'}));await screen.findByText(ticket.description);
 fireEvent.change(screen.getByLabelText('Trạng thái xử lý'),{target:{value:'CLOSED'}});fireEvent.change(screen.getByLabelText('Kết quả'),{target:{value:'RESOLVED'}});fireEvent.change(screen.getByLabelText('Phản hồi cho người gửi'),{target:{value:'Đã sửa và kiểm tra.'}});fireEvent.click(screen.getByRole('button',{name:'Lưu xử lý'}));await screen.findByText('Đã lưu xử lý.');
 expect(requests.find(r=>r.method==='PATCH')).toMatchObject({url:'/api/admin/feedback/'+id,body:{expectedRevision:1,status:'CLOSED',disposition:'RESOLVED',reply:'Đã sửa và kiểm tra.'}});
});
it('same-identity transport failure preserves exact draft and request ID for retry',async()=>{
 let first=true;vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){requests.push({url,method:'POST',body:JSON.parse(String(init.body))});if(first){first=false;throw new TypeError('offline');}return json(ticket);}return json(initial);}));
 render(<FeedbackPanel initial={initial} onAuthLost={()=>{}}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));await screen.findByRole('alert');expect(screen.getByLabelText('Mô tả')).toHaveValue(ticket.description);
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra / gửi lại cùng mã'}));await screen.findByText(/Đã nhận yêu cầu/);expect(requests[0].body).toEqual(requests[1].body);
});
it.each([200,401,403,500])('ignores old admin detail %s after session change',async(status)=>{
 let resolve!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(async()=>new Promise<Response>(r=>{resolve=r;})));const lost=vi.fn();const view=render(<FeedbackPanel initial={initial} admin onAuthLost={lost}/>);
 fireEvent.click(screen.getByRole('button',{name:'Lịch bị lỗi'}));view.rerender(<FeedbackPanel initial={{...initial,readerId:'B'.repeat(43),items:[]}} admin onAuthLost={lost}/>);await act(async()=>resolve(json(ticket,status)));
 expect(screen.queryByText(ticket.description)).not.toBeInTheDocument();expect(screen.queryByLabelText('Phản hồi cho người gửi')).not.toBeInTheDocument();expect(lost).not.toHaveBeenCalled();
});
it('drops old admin queue and detail on permission loss',async()=>{
 const lost=vi.fn();render(<FeedbackPanel initial={initial} admin onAuthLost={lost}/>);fireEvent.click(screen.getByRole('button',{name:'Lịch bị lỗi'}));await screen.findByText(ticket.description);
 vi.stubGlobal('fetch',vi.fn(async()=>json(null,403)));fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));await screen.findByText(/Phiên hoặc quyền truy cập đã thay đổi/);expect(screen.queryByText(ticket.description)).not.toBeInTheDocument();expect(screen.queryByLabelText('Phản hồi cho người gửi')).not.toBeInTheDocument();
});
it('does not render pasted markup or turn pasted URLs into links',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({...ticket,description:'<img src=x onerror=alert(1)> https://example.test/?token=secret'})));
 const view=render(<FeedbackPanel initial={initial} onAuthLost={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Lịch bị lỗi'}));await screen.findByText('<img src=x onerror=alert(1)> https://example.test/?token=secret');expect(view.container.querySelector('img')).toBeNull();expect(view.container.querySelector('a')).toBeNull();
});
it('clears an unknown A submission if cookies changed to B before same-ID retry',async()=>{
 let sends=0;vi.stubGlobal('fetch',vi.fn(async()=>{sends++;if(sends===1)throw new TypeError('offline');return new Response(JSON.stringify({error:{code:'IDENTITY_CHANGED',message:'Identity changed'}}),{status:409,headers:{'content-type':'application/json'}});}));
 const lost=vi.fn();render(<FeedbackPanel initial={initial} onAuthLost={lost}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Kiểm tra / gửi lại cùng mã'}));await screen.findByText(/Phiên hoặc quyền truy cập đã thay đổi/);expect(screen.queryByLabelText('Tiêu đề')).not.toBeInTheDocument();expect(lost).toHaveBeenCalledTimes(1);
});
