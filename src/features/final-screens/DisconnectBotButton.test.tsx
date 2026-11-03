import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect,it,vi } from "vitest";
import { DisconnectBotButton } from "./DisconnectBotButton";
it('requires explicit local disconnect confirmation and exposes its preservation scope',async()=>{
  const disconnect=vi.fn(async()=>{});const user=userEvent.setup();
  render(<DisconnectBotButton name="Bot riêng" pending={false} disconnect={disconnect}/>);
  await user.click(screen.getByRole('button',{name:'Ngắt kết nối'}));
  expect(disconnect).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('Lịch sử và lời nhắc được giữ lại');
  expect(screen.getByRole('dialog')).toHaveTextContent('Token mã hoá');
  await user.click(screen.getByRole('button',{name:'Giữ kết nối'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Ngắt kết nối'}));
  await user.click(screen.getByRole('button',{name:'Xác nhận ngắt kết nối'}));
  expect(disconnect).toHaveBeenCalledOnce();
});
