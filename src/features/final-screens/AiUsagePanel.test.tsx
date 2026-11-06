import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import {AiUsagePanel} from './AiUsagePanel';
const period={key:'2026-11',dispatchedCalls:3,knownCalls:2,knownCostMicrounits:10000,unknownCalls:1,unknownMaximumMicrounits:116759,pendingCalls:1,pendingMaximumMicrounits:116759,budgetedCalls:4,budgetedCostMicrounits:243518};
const snapshot={schemaVersion:'ai-usage-1',asOf:'2026-11-06T01:00:00Z',timezone:'UTC',currency:'USD',runtime:'READY',limits:{dailyCalls:50,monthlyCostMicrounits:500000},day:{...period,key:'2026-11-06'},month:period};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>vi.unstubAllGlobals());
it('shows known-only mean separately from unknown maximum and pending capacity in an accessible table',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({data:snapshot})));
 const {container}=render(<AiUsagePanel ownerKey="owner" />);
 const table=await screen.findByRole('table',{name:'Mức sử dụng AI theo kỳ UTC'});
 const row=within(table).getByRole('row',{name:/Ngày hiện tại/});
 expect(within(row).getByText('0.010000 USD')).toBeVisible();expect(within(row).getByText('0.005000 USD')).toBeVisible();
 expect(screen.getAllByText(/Chưa rõ: 1 lượt/)).toHaveLength(2);expect(screen.getAllByText(/Tối đa 0.116759 USD/)).toHaveLength(2);
 expect(screen.getByText(/dự phòng.*hóa đơn/)).toBeVisible();expect(screen.getByText(/UTC/,{selector:'small'})).toBeVisible();
 expect((await axe.run(container)).violations).toEqual([]);
});
it('does not claim a zero average when every charge is unknown; retries a failed read',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(json({},503)).mockResolvedValueOnce(json({data:{...snapshot,day:{...snapshot.day,knownCalls:0,knownCostMicrounits:0},month:{...period,knownCalls:0,knownCostMicrounits:0}}}));
 vi.stubGlobal('fetch',fetcher);render(<AiUsagePanel ownerKey="owner" />);
 expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tải được');
 await userEvent.click(screen.getByRole('button',{name:'Làm mới mức sử dụng AI'}));
 expect(await screen.findAllByText('Chưa có lượt biết chi phí')).toHaveLength(2);
});
it('clears data on authentication failure and never renders a late old-owner response',async()=>{
 let resolveOld!:(response:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce(json({},401));
 vi.stubGlobal('fetch',fetcher);const {rerender}=render(<AiUsagePanel ownerKey="old" />);
 rerender(<AiUsagePanel ownerKey="new" />);expect(await screen.findByRole('alert')).toHaveTextContent('Đăng nhập lại');
 resolveOld(json({data:snapshot}));await waitFor(()=>expect(screen.queryByRole('table')).not.toBeInTheDocument());
 expect(screen.queryByText('0.010000 USD')).not.toBeInTheDocument();
});
