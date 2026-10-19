import { apiRequest } from '@/lib/client-api';
/** Cursor is opaque data; never allow it to choose an origin or API path. */
export async function loadFollowThroughPage(cursor: string | undefined, onUnauthorized: () => void): Promise<unknown> {
    if (cursor === undefined)
        return apiRequest<unknown>('/api/v1/follow-through', { authenticated: true, onUnauthorized });
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(cursor))
        throw new Error('Trang tiến độ không hợp lệ.');
    const response = await fetch(`/api/v1/follow-through?cursor=${encodeURIComponent(cursor)}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    if (response.status === 401)
        onUnauthorized();
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body)
        throw new Error('Chưa thể tải trang tiến độ.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 128 * 1024) {
                void reader.cancel().catch(() => undefined);
                throw new Error('Trang tiến độ quá lớn.');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof payload !== 'object' || payload === null || !('data' in payload))
        throw new Error('Trang tiến độ không hợp lệ.');
    return payload.data;
}
