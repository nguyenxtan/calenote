const DAY = 86400000;
const OFFSET = 7 * 60 * 60000;
export function vietnamTime(value: string): number | null {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
    if (!parts)
        return null;
    const [, y, m, d, h, minute] = parts.map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, h, minute));
    if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d || at.getUTCHours() !== h || at.getUTCMinutes() !== minute)
        return null;
    return at.getTime() - OFFSET;
}
export function postponeAt(preset: '15m' | '1h' | 'tomorrow', now: number): number {
    if (preset !== 'tomorrow')
        return now + (preset === '15m' ? 15 : 60) * 60000;
    return Math.floor((now + OFFSET) / DAY) * DAY + DAY + 9 * 60 * 60000 - OFFSET;
}
export function absoluteTime(at: number): string {
    return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(at) + ' · giờ Việt Nam';
}
