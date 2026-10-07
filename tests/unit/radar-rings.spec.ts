import { test, expect } from "@playwright/test";
import { RING_FOR_BUCKET, RINGS } from "../../radar/RadarCanvas";

test("people are drawn exactly on the ring for their distance", () => {
  const ring = (label: string) => RINGS.find((r) => r.label === label)!.r;
  expect(RING_FOR_BUCKET["5m"]).toBe(ring("5 m"));
  expect(RING_FOR_BUCKET["10m"]).toBe(ring("10 m"));
  expect(RING_FOR_BUCKET["20m"]).toBe(ring("20 m"));
  expect(RING_FOR_BUCKET.very_close).toBeLessThan(ring("2 m"));
  expect(RING_FOR_BUCKET["3m"]).toBeGreaterThan(ring("2 m"));
  expect(RING_FOR_BUCKET["3m"]).toBeLessThan(ring("5 m"));
  expect(RING_FOR_BUCKET.far).toBeGreaterThan(ring("20 m"));
  // rings increase outward and stay inside the canvas
  const rs = RINGS.map((r) => r.r);
  expect([...rs].sort((a, b) => a - b)).toEqual(rs);
  expect(Math.max(...rs, RING_FOR_BUCKET.far)).toBeLessThan(1);
});
