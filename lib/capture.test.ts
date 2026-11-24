import { describe, expect, test } from 'bun:test';
import { API_LIMITED, createRequestGate } from './capture';

const errorOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => e.message);

function fakeClock() {
  const t = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => t,
    // Records the wait; time doesn't move (all callers arrive at once).
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    waits,
  };
}

describe('createRequestGate', () => {
  test('concurrent fallbacks are spaced, never a burst', async () => {
    const c = fakeClock();
    const gate = createRequestGate({ gapMs: 4000, jitterMs: 2000, cooldownMs: 300_000, now: c.now, sleep: c.sleep, rand: () => 0.5 });
    const out = await Promise.all([1, 2, 3].map((n) => gate.run(async () => n)));
    expect(out).toEqual([1, 2, 3]);
    // First goes now; the others wait their turn: 4000 + 0.5 * 2000 apart.
    expect(c.waits).toEqual([5000, 10000]);
  });

  test('a 429 shuts the gate for the cooldown, without calling Instagram', async () => {
    const c = fakeClock();
    const gate = createRequestGate({ gapMs: 10, jitterMs: 0, cooldownMs: 300_000, now: c.now, sleep: c.sleep });
    let calls = 0;
    const fail429 = async () => {
      calls++;
      throw new Error('media info responded 429');
    };
    expect(await errorOf(gate.run(fail429))).toBe(API_LIMITED);
    expect(await errorOf(gate.run(fail429))).toBe(API_LIMITED);
    expect(calls).toBe(1);
    // Other errors pass through untouched.
    const c2 = fakeClock();
    const g2 = createRequestGate({ gapMs: 0, jitterMs: 0, cooldownMs: 1, now: c2.now, sleep: c2.sleep });
    expect(await errorOf(g2.run(async () => Promise.reject(new Error('media info responded 404'))))).toBe('media info responded 404');
  });
});
