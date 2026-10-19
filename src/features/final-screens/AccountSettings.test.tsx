import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {AccountSettings} from './AccountSettings';
const user={displayName:'Mai',email:'mai@example.test',timezone:'Asia/Ho_Chi_Minh'} as const;
it('edits the account name, keeps email read only and requires explicit confirmation before revoking other sessions',async()=>{
 const interaction=userEvent.setup(),save=vi.fn(async()=>true),revoke=vi.fn(async()=>true);
 render(<AccountSettings user={user} saveProfile={save} sessions={[{id:'current',createdAt:1,expiresAt:200,current:true},{id:'other',createdAt:1,expiresAt:200,current:false}]} revokeOthers={revoke}/>);
 const name=screen.getByRole('textbox',{name:'Tên tài khoản'});await interaction.clear(name);await interaction.type(name,'  An  ');
 expect(save).not.toHaveBeenCalled();await interaction.click(screen.getByRole('button',{name:'Lưu tên tài khoản'}));expect(save).toHaveBeenCalledWith('An');
 expect(screen.getByText(user.email)).toBeVisible();expect(screen.queryByRole('textbox',{name:/Email/})).toBeNull();
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));expect(revoke).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'})).toBeVisible();await interaction.click(screen.getByRole('button',{name:'Huỷ'}));expect(revoke).not.toHaveBeenCalled();
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'}));await waitFor(()=>expect(revoke).toHaveBeenCalledOnce());
 expect(screen.getByText('Phiên hiện tại')).toBeVisible();
});
it('blocks invalid name and keeps failed session mutation recoverable',async()=>{
 const interaction=userEvent.setup(),save=vi.fn(),revoke=vi.fn(async()=>false);
 render(<AccountSettings user={user} saveProfile={save} sessions={[{id:'other',createdAt:1,expiresAt:200,current:false}]} revokeOthers={revoke}/>);
 await interaction.clear(screen.getByRole('textbox',{name:'Tên tài khoản'}));await interaction.click(screen.getByRole('button',{name:'Lưu tên tài khoản'}));expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('1 đến 80');
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'}));await waitFor(()=>expect(screen.getByText(/Chưa xác nhận được việc đăng xuất/)).toBeVisible());
});
it('disables duplicate profile and session requests and surfaces failed profile saves',async()=>{
 const interaction=userEvent.setup();let finishProfile!:(value:boolean)=>void;let finishRevoke!:(value:boolean)=>void;
 const save=vi.fn(()=>new Promise<boolean>(resolve=>{finishProfile=resolve;}));const revoke=vi.fn(()=>new Promise<boolean>(resolve=>{finishRevoke=resolve;}));
 render(<AccountSettings user={user} saveProfile={save} sessions={[{id:'other',createdAt:1,expiresAt:200,current:false}]} revokeOthers={revoke}/>);
 await interaction.click(screen.getByRole('button',{name:'Lưu tên tài khoản'}));expect(screen.getByRole('button',{name:'Đang lưu tên…'})).toBeDisabled();expect(screen.getByRole('textbox',{name:'Tên tài khoản'})).toBeDisabled();
 finishProfile(false);expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác nhận được việc lưu tên');
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'}));expect(screen.getByRole('button',{name:'Đang đăng xuất…'})).toBeDisabled();expect(screen.getByRole('button',{name:'Huỷ'})).toBeDisabled();
 finishRevoke(true);await screen.findByText('Đã đăng xuất các phiên khác. Phiên hiện tại vẫn hoạt động.');expect(save).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledOnce();
});
