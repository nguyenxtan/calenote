import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import {CalendarExportPanel} from './CalendarExportPanel';
const response=()=>new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',{headers:{'content-type':'text/calendar; charset=utf-8','x-calenote-export-truncated':'true','x-calenote-export-skipped':'2','x-calenote-export-events':'3'}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('downloads a blob and explains one-time export with partial and skipped counts accessibly',async()=>{
 let downloaded:Blob|undefined;const created=vi.fn((blob:Blob)=>{downloaded=blob;return 'blob:calendar';});
 vi.stubGlobal('fetch',vi.fn(async()=>response()));vi.stubGlobal('URL',class extends URL{static createObjectURL=created;static revokeObjectURL=vi.fn();});
 const clicked:HTMLAnchorElement[]=[];vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){clicked.push(this);});
 const {container}=render(<CalendarExportPanel ownerKey="owner"/>);
 expect(screen.getByText(/Tải một lần/)).toHaveTextContent('không tự cập nhật');
 await userEvent.click(screen.getByRole('button',{name:'Tải lịch (.ics)'}));
 expect(await screen.findByRole('status')).toHaveTextContent('3 mục');expect(screen.getByRole('status')).toHaveTextContent('một phần');expect(screen.getByRole('status')).toHaveTextContent('Bỏ qua 2 mục');
 expect(downloaded?.type).toContain('text/calendar');expect(clicked[0].download).toBe('calenote.ics');expect(clicked[0].href).toBe('blob:calendar');
 expect((await axe.run(container,{rules:{'color-contrast':{enabled:false}}})).violations).toEqual([]);
});
it('rejects unauthenticated/invalid responses and allows retry without claiming a download',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(new Response('<html>login</html>',{headers:{'content-type':'text/html'}})));
 render(<CalendarExportPanel ownerKey="owner"/>);await userEvent.click(screen.getByRole('button',{name:'Tải lịch (.ics)'}));expect(await screen.findByRole('alert')).toHaveTextContent('Đăng nhập lại');
 await userEvent.click(screen.getByRole('button',{name:'Tải lịch (.ics)'}));expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tải được');expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('never creates a download from a late old-owner response',async()=>{
 let resolve!:(r:Response)=>void;const created=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=created;static revokeObjectURL=vi.fn();});
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));
 const {rerender}=render(<CalendarExportPanel ownerKey="old"/>);await userEvent.click(screen.getByRole('button',{name:'Tải lịch (.ics)'}));rerender(<CalendarExportPanel ownerKey="new"/>);
 resolve(response());await waitFor(()=>expect(screen.getByRole('button',{name:'Tải lịch (.ics)'})).toBeEnabled());
 expect(created).not.toHaveBeenCalled();expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
