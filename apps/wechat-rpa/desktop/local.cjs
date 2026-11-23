// Only included in the standalone Windows test edition.
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const install = __dirname;
const data = path.join(process.env.LOCALAPPDATA, "HuojiCaptureTest", "Data");
const origin = "http://127.0.0.1:5196";
fs.mkdirSync(data, {recursive: true});
// The test edition never inherits production credentials from the build or host.
for (const key of Object.keys(process.env)) {
  if (/^(DEEPSEEK_|HUOJI_|RPA_|SMS_|CAPTCHA_|TENCENT|ENTERPRISE_|ALIPAY_|PAYMENT_|AUTH_STATE_FILE)/i.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: "test", AI_PROVIDER: "mock", SMS_PROVIDER: "mock", SMS_UNIVERSAL_CODE: "", CAPTCHA_PROVIDER: "none",
  RPA_LOCAL_CONTROL: "1", RPA_LOCAL_ORIGIN: origin, RPA_LOCAL_REPOSITORY_ROOT: data,
  HUOJI_DESKTOP_TEST: "1", HUOJI_DESKTOP_RUNTIME: install,
  HUOJI_CAPTURE_LOCK_PATH: path.join(data,"desktop.capture.lock"),
  AUTH_STATE_FILE: path.join(data, "identity.json"), RPA_MESSAGES_FILE: path.join(data, "messages.json"),
  PAYMENT_ORDERS_FILE: path.join(data, "payments.json"),
});
const {app, stopLocalRealtime} = require("../../../demo_ui/server.ts");
const site = express();
site.use((req,res,next) => {
  if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return res.sendStatus(403);
  next();
});
site.use(app);
site.use(express.static(path.join(install, "web")));
site.get(/.*/, (_req,res) => res.sendFile(path.join(install,"web","index.html")));
const server = site.listen(5196,"127.0.0.1", () => console.log("HUOJI_READY"));
server.on("error", () => { process.exitCode = 1; process.stdin.destroy(); });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  stopLocalRealtime();
  server.close();
  process.stdin.destroy();
}
process.stdin.resume();
process.stdin.on("end", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
