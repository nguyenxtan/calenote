import { expect, it, vi } from 'vitest';
import { loadFollowThroughPage } from './list-client';
it('rejects cursor path injection before fetch', async () => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await expect(loadFollowThroughPage('../admin', vi.fn())).rejects.toThrow('không hợp lệ'); expect(fetcher).not.toHaveBeenCalled(); });
it('bounds streamed pages before JSON parsing', async () => { vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(128 * 1024 + 1), { headers: { 'content-type': 'application/json' } }))); await expect(loadFollowThroughPage('work1', vi.fn())).rejects.toThrow('quá lớn'); });
it('notifies the session owner on unauthorized older pages', async () => { const unauthorized = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 }))); await expect(loadFollowThroughPage('work1', unauthorized)).rejects.toThrow(); expect(unauthorized).toHaveBeenCalledTimes(1); });
