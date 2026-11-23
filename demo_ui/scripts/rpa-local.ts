/** Isolated, loopback-only RPA validation. Never loads production env or data. */
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(projectDirectory, ".data", "rpa-local");
process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "mock";
process.env.SMS_PROVIDER = "mock";
process.env.CAPTCHA_PROVIDER = "none";
process.env.SMS_UNIVERSAL_CODE = "";
process.env.AUTH_STATE_FILE = path.join(dataDirectory, "identity.json");
process.env.RPA_MESSAGES_FILE = path.join(dataDirectory, "messages.json");
process.env.PAYMENT_ORDERS_FILE = path.join(dataDirectory, "payments.json");

const port = Number(process.env.RPA_LOCAL_PORT ?? 5186);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("RPA_LOCAL_PORT 必须在 1024–65535 范围内。");
// Process controls are registered only by this loopback launcher, never by production startup.
process.env.RPA_LOCAL_CONTROL = "1";
const reviewersFile = path.join(dataDirectory, "enterprise-reviewers.json");
const reviewerPhones: unknown = existsSync(reviewersFile) ? JSON.parse(readFileSync(reviewersFile, "utf8")) : [];
if (!Array.isArray(reviewerPhones) || !reviewerPhones.every(phone => typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone))) {
  throw new Error("本机企业审核员名单格式有误。");
}
process.env.HUOJI_LOCAL_REVIEWER_PHONES = reviewerPhones.join(",");
const adminsFile = path.join(dataDirectory, "platform-admins.json");
if (existsSync(adminsFile)) {
  const phones: unknown = JSON.parse(readFileSync(adminsFile, "utf8"));
  if (!Array.isArray(phones) || !phones.every(phone => typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone))) {
    throw new Error("本机平台管理员名单格式有误。");
  }
  process.env.HUOJI_PLATFORM_ADMIN_PHONES = phones.join(",");
}
process.env.RPA_LOCAL_ORIGIN = `http://127.0.0.1:${port}`;
process.env.RPA_LOCAL_REPOSITORY_ROOT = path.resolve(projectDirectory, "..");
const { app, stopLocalRealtime } = await import("../server");
app.use(express.static(path.join(projectDirectory, "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(projectDirectory, "dist", "index.html")));
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`[货记 RPA 本机验证] http://127.0.0.1:${port}`);
  console.log("仅本机可访问；使用模拟短信和本地规则解析，验证码显示在登录页面。");
  console.log("账号、消息及订单写入 .data/rpa-local，与其他运行环境分开保存。");
});
server.on("error", (error) => { console.error("本机验证服务启动失败：", error.message); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopLocalRealtime();
  server.close(() => { process.exitCode = 0; });
});
