const path = require("node:path");
const { createCloudGateway } = require("../../../demo_ui/server/rpa-cloud-gateway.ts");
const data = path.join(process.env.LOCALAPPDATA, "HuojiCaptureCloud", "Data");
process.env.HUOJI_CAPTURE_LOCK_PATH = path.join(data, "desktop.capture.lock");
process.env.HUOJI_DESKTOP_TEST = "1"; // Enable the verified Windows layout templates in the OCR worker.
const { site, stop } = createCloudGateway({
  service: "https://huoij.com",
  origin: "http://127.0.0.1:5197",
  runtime: __dirname,
  data,
});
const server = site.listen(5197, "127.0.0.1", () => console.log("HUOJI_READY"));
server.on("error", () => {
  process.exitCode = 1;
  process.stdin.destroy();
  stop();
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  stop();
  server.close();
  process.stdin.destroy();
}
process.stdin.resume();
process.stdin.on("end", shutdown);
process.once("SIGTERM", shutdown);
