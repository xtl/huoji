import * as fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface ReplacementOperations {
  /** Operation seams let tests inject faults without changing the host filesystem or sleeping. */
  rename?: typeof fs.renameSync;
  pause?: (milliseconds: number) => void;
  platform?: NodeJS.Platform;
}
const retryDelays = [5, 10, 20, 40, 80];
const waitCell = new Int32Array(new SharedArrayBuffer(4));

function replaceSnapshot(temporary: string, filePath: string, operations: ReplacementOperations): void {
  const rename = operations.rename ?? fs.renameSync;
  const pause = operations.pause ?? ((milliseconds: number) => { Atomics.wait(waitCell, 0, 0, milliseconds); });
  for (let attempt = 0; ; attempt += 1) {
    try { rename(temporary, filePath); return; }
    catch (error) {
      const retryable = (operations.platform ?? process.platform) === "win32"
        && ["EPERM", "EBUSY", "EACCES"].includes(String((error as NodeJS.ErrnoException).code));
      if (!retryable || attempt >= retryDelays.length) throw error;
      // Windows scanners can briefly deny replacement. Keep the old target and retry the same atomic rename.
      pause(retryDelays[attempt]);
    }
  }
}

/** Single-process durable JSON storage. A failed write never replaces the last snapshot. */
export function writeAtomicJson(filePath: string, value: unknown, operations: ReplacementOperations = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    replaceSnapshot(temporary, filePath, operations);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* The rename may already have completed. */ }
    throw error;
  }
}

export function readJsonSnapshot(filePath: string): unknown | undefined {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
