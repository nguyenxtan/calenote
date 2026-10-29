import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { BotCreationGuide } from './BotCreationGuide';
it('shows one action at a time and resets progress when switching platform', async () => {
 const user=userEvent.setup(); render(<BotCreationGuide/>);
 await user.click(screen.getByRole('button',{name:'Zalo'}));
 expect(screen.getByRole('heading',{name:'Tìm Zalo Bot Manager'})).toBeVisible();
 expect(screen.queryByText(/bắt đầu bằng Bot/)).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Tiếp theo'}));
 expect(screen.getByRole('heading',{name:'Chọn Tạo bot'})).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Telegram'}));
 expect(screen.getByRole('heading',{name:'Mở BotFather'})).toBeVisible();
 expect(screen.getByRole('link',{name:/Mở BotFather/})).toHaveAttribute('href','https://t.me/BotFather');
 expect(screen.getByRole('button',{name:'Quay lại'})).toBeDisabled();
});
