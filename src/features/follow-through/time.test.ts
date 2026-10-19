import { describe, expect, it } from 'vitest';
import { postponeAt, vietnamTime } from './time';
describe('explicit Vietnam scheduling', () => {
    it('resolves tomorrow 09:00 across UTC midnight', () => { expect(postponeAt('tomorrow', Date.parse('2026-10-19T23:50:00+07:00'))).toBe(Date.parse('2026-10-20T09:00:00+07:00')); });
    it('rejects impossible civil dates and hour overflow', () => { expect(vietnamTime('2026-02-30T09:00')).toBeNull(); expect(vietnamTime('2026-10-20T25:00')).toBeNull(); });
    it('converts civil time independent of browser timezone', () => { expect(vietnamTime('2026-10-20T09:00')).toBe(Date.parse('2026-10-20T02:00:00Z')); });
});
