import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FollowThroughItem } from '@/contracts/api/follow-through';
import { FollowThroughPanel } from './FollowThroughPanel';
const item: FollowThroughItem = { publicId: 'work1', title: 'Gọi mẹ', progress: 'OPEN', revision: 1, currentReminderPublicId: 'reminder1', scheduledAt: 1800000000000, deliveryStatus: 'SENT', destinationLabel: 'Telegram · Gia đình', followUpEnabled: false, intervalMinutes: 30, followUpCount: 0, nextFollowUpAt: null, completedAt: null, history: [{ publicId: 'reminder1', kind: 'ORIGINAL', scheduledAt: 1800000000000, deliveryStatus: 'SENT' }] };
const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
beforeEach(() => { sessionStorage.clear(); });
it('keeps sent delivery separate from open progress and previews bot/time before postponing', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_, options?: RequestInit) => { if (options?.method === 'POST') {
        bodies.push(JSON.parse(options.body as string));
        return json({ item: { ...item, revision: 2 } });
    } return json({ items: [item] }); }));
    const user = userEvent.setup();
    render(<FollowThroughPanel ownerKey="owner"/>);
    expect(await screen.findByText('Tiến độ: Chưa xong')).toBeVisible();
    expect(screen.getByText('Gửi nhắc: Đã gửi')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hoãn 15 phút' }));
    expect(bodies).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Xác nhận thay đổi' })).toHaveTextContent('Telegram · Gia đình');
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ action: 'SNOOZE', publicId: 'work1', expectedRevision: 1 });
});
it('retries the identical durable receipt after lost response and remount', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_, options?: RequestInit) => { if (options?.method === 'POST') {
        bodies.push(JSON.parse(options.body as string));
        if (bodies.length === 1)
            throw new TypeError('lost');
        return json({ item: { ...item, progress: 'DONE', revision: 2 } });
    } return json({ items: [item] }); }));
    const user = userEvent.setup();
    const first = render(<FollowThroughPanel ownerKey="owner"/>);
    await screen.findByText('Tiến độ: Chưa xong');
    await user.click(within(screen.getByRole('article')).getByRole('button', { name: 'Đã xong' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await screen.findByText(/Kết quả chưa xác định/);
    expect(JSON.stringify(sessionStorage)).not.toContain('Gọi mẹ');
    first.unmount();
    render(<FollowThroughPanel ownerKey="owner"/>);
    await user.click(await screen.findByRole('button', { name: 'Kiểm tra yêu cầu trước' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual(bodies[0]);
});
it('adopts legacy explicitly and rejects invalid reschedule without a mutation', async () => {
    const fetcher = vi.fn(async () => json({ items: [{ ...item, progress: 'UNTRACKED', revision: 0 }] }));
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<FollowThroughPanel ownerKey="owner"/>);
    await user.click(await screen.findByRole('button', { name: 'Chưa theo dõi' }));
    await user.click(screen.getByRole('button', { name: 'Theo dõi việc này' }));
    expect(screen.getByRole('region', { name: 'Xác nhận thay đổi' })).toHaveTextContent('Theo dõi việc này');
    expect(fetcher.mock.calls).toHaveLength(1);
});
it('previews opt-in policy with finite quota and an approximate absolute next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item] })));
    const user = userEvent.setup();
    render(<FollowThroughPanel ownerKey="owner"/>);
    await screen.findByText('Tiến độ: Chưa xong');
    await user.click(screen.getByText('Đổi lịch và nhắc tiếp'));
    await user.click(screen.getByRole('button', { name: 'Bật nhắc tiếp' }));
    const preview = screen.getByRole('region', { name: 'Xác nhận thay đổi' });
    expect(preview).toHaveTextContent('0/3');
    expect(preview).toHaveTextContent('Dự kiến');
    expect(preview).toHaveTextContent('giờ Việt Nam');
});
it('loads older work with a bounded cursor and leaves progress filters available', async () => {
    const fetcher = vi.fn(async (path: string | URL | Request) => json(path === '/api/v1/follow-through' ? { items: [item], nextCursor: 'work1' } : { items: [{ ...item, publicId: 'work2', title: 'Thanh toán điện' }] }));
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<FollowThroughPanel ownerKey="owner"/>);
    await user.click(await screen.findByRole('button', { name: 'Tải thêm việc' }));
    expect(await screen.findByText('Thanh toán điện')).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith('/api/v1/follow-through?cursor=work1', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
});
it('validates rescheduling and keeps exhausted policy visibly finite', async () => {
    const fetcher = vi.fn(async () => json({ items: [{ ...item, followUpCount: 3, followUpEnabled: true }] }));
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<FollowThroughPanel ownerKey="owner"/>);
    await screen.findByText('Tiến độ: Chưa xong');
    await user.click(screen.getByText('Đổi lịch và nhắc tiếp'));
    fireEvent.change(screen.getByLabelText('Ngày giờ Việt Nam'), { target: { value: '2020-01-01T09:00' } });
    await user.click(screen.getByRole('button', { name: 'Đổi lịch' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tương lai');
    expect(screen.getByText('Đã đạt giới hạn 3 lần. Không tự gửi thêm.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Bật nhắc tiếp' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
});
it('supports keyboard confirmation with no automated accessibility violations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item] })));
    const user = userEvent.setup();
    const { container } = render(<FollowThroughPanel ownerKey="owner"/>);
    await screen.findByText('Tiến độ: Chưa xong');
    const done = within(screen.getByRole('article')).getByRole('button', { name: 'Đã xong' });
    done.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Xác nhận thay đổi' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.queryByRole('region', { name: 'Xác nhận thay đổi' })).not.toBeInTheDocument();
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});
