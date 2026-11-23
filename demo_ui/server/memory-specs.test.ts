import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompactMemorySpec, readMemoryFrequency } from "../src/memory-specs";

test("the buyer's shorthand and the white-label offer have the same memory geometry", () => {
  for (const text of ["测试采购SK 64g6400 dc25 160条", "SK颗粒白牌 64 GB 6400 DC25 120条"]) {
    assert.deepEqual(readCompactMemorySpec(text), { capacity: "64G", frequency: "6400" });
    assert.equal(readMemoryFrequency(text), "6400");
  }
});

test("capture dates, quantities and yuan amounts do not become memory speeds", () => {
  const text = "2026-11-22 到货 64G 6400条，4800元";
  assert.equal(readCompactMemorySpec(text), null);
  assert.equal(readMemoryFrequency(text), "");
  assert.equal(readMemoryFrequency("DDR5-6400 200条"), "6400");
  assert.equal(readMemoryFrequency("内存 64 GB 报频率 5600 MT/s"), "5600");
});
