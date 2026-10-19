import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,it,expect,vi} from 'vitest';
import axe from 'axe-core';
import {AppearanceSettings} from './AppearanceSettings';
afterEach(()=>vi.unstubAllGlobals());
describe('appearance settings',()=>{
 it('changes real device preferences together and restores them after remount',async()=>{
  const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});
  const user=userEvent.setup();const view=render(<AppearanceSettings/>);
  await user.click(screen.getByRole('button',{name:/^Gọn/}));
  await user.selectOptions(screen.getByLabelText('Cỡ chữ'),'large');
  await user.selectOptions(screen.getByLabelText('Ngày bắt đầu tuần'),'sunday');
  await user.selectOptions(screen.getByLabelText('Trang mở sau khi đăng nhập'),'calendar');
  await user.click(screen.getByRole('switch',{name:'Hiển thị âm lịch'}));
  expect(document.documentElement.dataset.density).toBe('compact');expect(document.documentElement.dataset.textSize).toBe('large');
  view.unmount();render(<AppearanceSettings/>);
  await waitFor(()=>expect(screen.getByLabelText('Cỡ chữ')).toHaveValue('large'));
  expect(screen.getByRole('button',{name:/^Gọn/})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('switch')).not.toBeChecked();expect(screen.getByLabelText('Ngày bắt đầu tuần')).toHaveValue('sunday');expect(screen.getByLabelText('Trang mở sau khi đăng nhập')).toHaveValue('calendar');
 });
 it('offers a usable page with accessible controls when storage is blocked',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}});
  const {container}=render(<AppearanceSettings/>);await userEvent.click(screen.getByRole('button',{name:/^Gọn/}));
  expect(screen.getByRole('status')).toHaveTextContent('không cho phép lưu');
  expect((await axe.run(container,{rules:{'color-contrast':{enabled:false},region:{enabled:false}}})).violations).toEqual([]);
 });
});
