import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
it("offers1–7days and1–24hours, saves two independent advances, and can disable either",async()=>{
 const interaction=userEvent.setup(),save=vi.fn().mockResolvedValue(true);
 render(<SettingsPanel user={{displayName:"Tân",email:"qa@example.test",timezone:"Asia/Ho_Chi_Minh"}} value={{addressStyle:"ban",customDisplayName:null,tone:"friendly"}} save={save} notice={null} busy={false}/>);
 const days=screen.getByRole("combobox",{name:"Nhắc trước theo ngày"}),hours=screen.getByRole("combobox",{name:"Nhắc trước theo giờ"});
 expect(within(days).getAllByRole("option")).toHaveLength(8);expect(within(hours).getAllByRole("option")).toHaveLength(25);
 await interaction.selectOptions(days,"2");await interaction.selectOptions(hours,"3");expect(save).not.toHaveBeenCalled();
 await interaction.click(screen.getByRole("button",{name:"Lưu cá nhân hoá"}));expect(save).toHaveBeenLastCalledWith(expect.objectContaining({advanceReminderDays:2,advanceReminderHours:3}));
 await interaction.selectOptions(days,"");await interaction.click(screen.getByRole("button",{name:"Lưu cá nhân hoá"}));expect(save).toHaveBeenLastCalledWith(expect.objectContaining({advanceReminderDays:null,advanceReminderHours:3}));
});
