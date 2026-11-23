import type { ChildProcess } from "node:child_process";

interface LiveCapture {
  scope: string;
  startedAt: string;
  stopping: boolean;
  uploaded: number;
  lastCheck?: string;
  note?: string;
}

/** One desktop, one supervised live reader. Only its owner sees progress or can stop it. */
export class RealtimeCapture {
  private child?: ChildProcess;
  private state?: LiveCapture;
  private watchdog?: ReturnType<typeof setInterval>;

  get busy() {
    return !!this.child;
  }
  status(scope: string) {
    if (this.state?.scope !== scope) return { running: false, occupied: this.busy };
    const { scope: _scope, ...state } = this.state;
    return { ...state, running: this.busy, occupied: false };
  }
  start(scope: string, launch: () => ChildProcess, authorized: () => boolean) {
    const child = launch();
    this.child = child;
    const state: LiveCapture = { scope, startedAt: new Date().toISOString(), stopping: false, uploaded: 0 };
    this.state = state;
    let buffered = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      buffered += String(chunk);
      if (buffered.length > 131072) {
        buffered = "";
        return;
      }
      const lines = buffered.split("\n");
      buffered = lines.pop()!;
      for (const line of lines) {
        try {
          const result = JSON.parse(line);
          state.lastCheck = new Date().toISOString();
          if (Number.isSafeInteger(result.uploaded) && result.uploaded > 0) state.uploaded += result.uploaded;
          if (state.stopping) continue;
          if (result.uploadError) state.note = "上传未完成，消息已保存在当前空间的队列中。";
          else if (result.status === "PAUSED_FOR_BACKFILL") state.note = "正在等待微信窗口空闲。";
          else if (result.status === "NO_ENABLED_GROUPS") state.note = "当前空间没有启用采集群。";
          else if (
            result.status === "FAILED_CLOSED" ||
            result.groups?.some((g: { status?: string }) => g.status !== "OK")
          )
            state.note = "部分群窗口无法读取，请检查独立窗口和校准。";
          else state.note = undefined;
        } catch {
          /* Worker output can include native-library diagnostics. */
        }
      }
    });
    const finished = (failed: boolean) => {
      if (this.child !== child) return;
      clearInterval(this.watchdog);
      if (failed && !state.stopping) state.note = "实时采集进程已退出，请检查采集环境后重试。";
      state.stopping = false;
      this.child = undefined;
    };
    child.once("error", () => finished(true));
    child.once("close", (code) => finished(code !== 0));
    child.stdin?.on("error", () => {
      /* Closing an already exited child is harmless. */
    });
    this.watchdog = setInterval(() => {
      let valid = false;
      try {
        valid = authorized();
      } catch {
        /* Stop if the binding can no longer be verified. */
      }
      if (!valid) this.stop("连接已失效，实时采集已停止。");
    }, 5000);
    this.watchdog.unref();
  }
  stop(note = "实时采集已停止。") {
    if (!this.child || !this.state || this.state.stopping) return;
    this.state.stopping = true;
    this.state.note = note;
    this.child.stdin?.end();
  }
}
