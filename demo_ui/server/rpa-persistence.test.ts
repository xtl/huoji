import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";

function location(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".rpa-persistence-test-"));
  t.after(() => {
    assert.equal(path.resolve(directory).startsWith(path.join(process.cwd(), ".rpa-persistence-test-")), true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, filePath: path.join(directory, "snapshot.json") };
}
function failure(code: string): NodeJS.ErrnoException { return Object.assign(new Error(`controlled ${code}`), { code }); }

test("Windows transient replacement denial retries the same fsynced temp while preserving the old target", (t) => {
  const { directory, filePath } = location(t);
  fs.writeFileSync(filePath, JSON.stringify({ version: "old" }));
  const attempts: Array<[string, string]> = [];
  const pauses: number[] = [];
  writeAtomicJson(filePath, { version: "new" }, {
    platform: "win32", pause: (delay) => pauses.push(delay),
    rename: (temporary, target) => {
      attempts.push([String(temporary), String(target)]);
      assert.deepEqual(readJsonSnapshot(filePath), { version: "old" });
      assert.deepEqual(readJsonSnapshot(String(temporary)), { version: "new" });
      const denied = ["EPERM", "EBUSY", "EACCES"][attempts.length - 1];
      if (denied) throw failure(denied);
      fs.renameSync(temporary, target);
    },
  });
  assert.equal(attempts.length, 4);
  assert.equal(new Set(attempts.map(([temporary]) => temporary)).size, 1);
  assert.equal(attempts.every(([, target]) => target === filePath), true);
  assert.deepEqual(pauses, [5, 10, 20]);
  assert.deepEqual(readJsonSnapshot(filePath), { version: "new" });
  assert.deepEqual(fs.readdirSync(directory), ["snapshot.json"]);
});

test("permanent Windows replacement failure exhausts bounded retries, keeps old bytes and removes only the temp", (t) => {
  const { directory, filePath } = location(t);
  const oldBytes = '{"version":"old","preserve":"exact bytes"}\n';
  fs.writeFileSync(filePath, oldBytes);
  const expected = failure("EPERM");
  const pauses: number[] = [];
  const temporaries = new Set<string>();
  let attempts = 0;
  assert.throws(() => writeAtomicJson(filePath, { version: "new" }, {
    platform: "win32", pause: (delay) => pauses.push(delay),
    rename: (temporary, target) => {
      attempts += 1; temporaries.add(String(temporary));
      assert.equal(String(target), filePath);
      assert.equal(fs.readFileSync(filePath, "utf8"), oldBytes);
      throw expected;
    },
  }), (error) => error === expected);
  assert.equal(attempts, 6);
  assert.equal(temporaries.size, 1);
  assert.deepEqual(pauses, [5, 10, 20, 40, 80]);
  assert.equal(fs.readFileSync(filePath, "utf8"), oldBytes);
  assert.deepEqual(fs.readdirSync(directory), ["snapshot.json"]);
});

test("non-transient errors and non-Windows errors are never retried or converted into success", (t) => {
  const { directory, filePath } = location(t);
  fs.writeFileSync(filePath, "old");
  for (const [platform, code] of [["win32", "ENOSPC"], ["linux", "EPERM"]] as const) {
    let attempts = 0; let paused = false;
    assert.throws(() => writeAtomicJson(filePath, { version: "new" }, { platform, pause: () => { paused = true; }, rename: () => { attempts += 1; throw failure(code); } }), (error: NodeJS.ErrnoException) => error.code === code);
    assert.equal(attempts, 1); assert.equal(paused, false);
    assert.equal(fs.readFileSync(filePath, "utf8"), "old");
    assert.deepEqual(fs.readdirSync(directory), ["snapshot.json"]);
  }
});
