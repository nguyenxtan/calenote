import { performance } from "node:perf_hooks";
import { extractTemporalEvidence } from "../../src/modules/semantic/temporal-evidence.ts";

const referenceNow = Date.UTC(2026, 8, 16, 2);
const cases = [
  { name: "short", text: "mai 8h nhắc tui gọi khách" },
  { name: "multiple", text: "8h 20/09 rồi xem tuần này và sắp tới" },
  {
    name: "adversarial-1kb",
    text: "20//09 8:00 :30 mai-mốt ".repeat(40).slice(0, 1_024),
  },
] as const;
const warmupIterations = 500;
const measuredIterations = 5_000;

for (const fixture of cases) {
  for (let index = 0; index < warmupIterations; index += 1) {
    extractTemporalEvidence({ text: fixture.text, referenceNow });
  }
}

const samples: number[] = [];
for (const fixture of cases) {
  for (let index = 0; index < measuredIterations; index += 1) {
    const startedAt = performance.now();
    extractTemporalEvidence({ text: fixture.text, referenceNow });
    samples.push(performance.now() - startedAt);
  }
}

samples.sort((left, right) => left - right);
function percentile(percent: number): number {
  return samples[Math.min(samples.length - 1, Math.floor(samples.length * percent))];
}

console.log(JSON.stringify({
  cases: cases.map((fixture) => ({ name: fixture.name, inputCodeUnits: fixture.text.length })),
  samples: samples.length,
  p50Ms: percentile(0.50),
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
}));
