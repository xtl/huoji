const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const profiles = [
  "机架小周", "鹏城阿凯", "阿宁找货", "云仓小陆", "芯片阿梁", "装机小冯",
  "深南老许", "小苏谈机柜", "西塘小郑", "海岸阿何", "星桥小蒋", "海岚小罗",
  "湾区阿韩", "老顾做服务器", "青禾小严", "工位阿唐", "江城阿沈", "小余做配件",
  "越城小吴", "东港阿程", "上塘小魏", "阿夏配内存", "南站小赵", "阿柳找现货",
  "柜边老戴", "天河小邱", "阿岑谈算力", "松湾阿任", "嘉禾小段", "小袁找整机",
];
const products = [
  ["GB300", "GB300 NVL72 整柜", "柜", [1, 2, 4]],
  ["B300", "B300 8 卡整机", "台", [2, 4, 8]],
  ["B200", "B200 8 卡整机", "台", [2, 4, 8, 16]],
  ["H200", "H200 8 卡整机", "台", [4, 8, 16, 32]],
  ["H100", "H100 8 卡整机", "台", [2, 4, 8, 12]],
  ["H20", "H20 96G 整机", "台", [2, 4, 8, 16]],
  ["A100", "A100 80G 显卡", "张", [4, 8, 16, 32]],
  ["A800", "A800 80G 显卡", "张", [4, 8, 16]],
  ["910C", "昇腾 910C 整机", "台", [2, 4, 8]],
  ["5090", "RTX 5090 显卡", "张", [4, 8, 24, 48]],
  ["DDR4", "64GB DDR4 3200 服务器内存", "条", [20, 40, 80, 120]],
  ["DDR5", "64GB DDR5 6400 服务器内存", "条", [32, 64, 128, 200]],
];
const cities = ["深圳", "广州", "上海", "北京", "杭州", "苏州", "香港", "成都"];
const spotSupply = ["可分批交付，验货后提货。", "可安排看货，报价按含税自提核算。", "支持现场验机，整批优先。"];
const spotDemand = ["请报含税价及最快交付时间。", "优先本地现货，可分批到货。", "请注明成色、质保和是否支持验货。"];
const DAY = 86400000;
const SHANGHAI_OFFSET = 8 * 3600000;
const prefix = "circle-demo-v1-";
const digest = input => createHash("sha256").update(input).digest("hex");
const snapshot = file => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

const [phone, endDate] = process.argv.slice(2);
if (!/^1\d{10}$/.test(phone ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? "")) {
  throw new Error("Provide the owner phone and final date in YYYY-MM-DD format.");
}
const endDay = Date.parse(endDate + "T00:00:00+08:00");
const runAt = Date.now();
const shanghaiDay = time => new Date(time + SHANGHAI_OFFSET).toISOString().slice(0, 10);
if (!Number.isFinite(endDay) || endDay > runAt || shanghaiDay(endDay) !== endDate) {
  throw new Error("Invalid or future Beijing date.");
}

const identityFile = process.env.AUTH_STATE_FILE?.trim() || path.resolve(".data", "identity.json");
const identity = snapshot(identityFile);
const user = identity.users.find(entry => entry.phone === phone);
const workspace = user && identity.workspaces.find(entry => entry.ownerUserId === user.id && entry.type === "PERSONAL");
if (!workspace) throw new Error("The owner's personal workspace was not found.");
const owner = "hj_" + digest(JSON.stringify([user.id, workspace.id])).slice(0, 28);
const scores = new Map(products.map(([model]) => [model, 0]));
const captureFile = process.env.RPA_MESSAGES_FILE?.trim() || path.resolve(".data", "rpa-messages.json");
try {
  for (const message of snapshot(captureFile).messages) {
    if (message.userId !== user.id || message.workspaceId !== workspace.id) continue;
    const items = message.parsedResult?.data?.items ?? [];
    // Only count the preapproved model names. Every published field comes from synthetic templates.
    const modelText = items.map(item => [item?.gpuModel, item?.model, item?.title].join(" ")).join("\n").toUpperCase();
    for (const [model] of products) {
      if (new RegExp("(?<![A-Z0-9])" + model + "(?![0-9])").test(modelText)) {
        scores.set(model, scores.get(model) + 1);
      }
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const referenced = products.filter(([model]) => scores.get(model) > 0)
  .sort(([first], [second]) => scores.get(second) - scores.get(first));
const mix = [...referenced, ...products];
const db = new DatabaseSync(path.join(path.dirname(identityFile), "circle.sqlite"));
try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
  const columns = db.prepare("PRAGMA table_info(posts)").all();
  if (columns.length && !columns.some(column => column.name === "demoAuthor")) {
    db.exec("ALTER TABLE posts ADD COLUMN demoAuthor TEXT");
  }
  db.prepare("INSERT OR IGNORE INTO actors(id,name,account) VALUES(?,?,?)")
    .run(owner, phone.slice(0, 3) + "****" + phone.slice(-4), user.id);
  const save = db.prepare(`INSERT INTO posts
    (id,owner,nonce,kind,title,quantity,city,mode,role,businessRole,price,terms,publishedAt,expiresAt,confirmedAt,companyName,demoAuthor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,nonce) DO NOTHING`);
  const expiresAt = new Date(endDay + 31 * DAY).toISOString();
  let inserted = 0;
  for (let day = 0; day < 15; day += 1) {
    const midnight = endDay - (14 - day) * DAY;
    const date = shanghaiDay(midnight);
    const lastTime = Math.min(midnight + 21 * 3600000, runAt);
    const morning = midnight + 8 * 3600000;
    const firstTime = lastTime > morning ? morning : midnight;
    for (let slot = 0; slot < 50; slot += 1) {
      const index = day * 50 + slot;
      const sample = (slot * 17 + day * 11) % 50;
      const supply = sample % 5 < 3;
      const [, model, unit, quantities] = mix[(sample + day * 3) % mix.length];
      const quantity = quantities[(sample + day) % quantities.length] + unit;
      const city = cities[(sample * 3 + day) % cities.length];
      const mode = unit === "台" && sample % 8 === 0 ? "租赁" : sample % 7 === 0 ? "期货" : "现货";
      const terms = mode === "租赁"
        ? supply ? "月租，可安排上架，电费另计。" : "先租三个月，请报月租、机房位置及电费。"
        : mode === "期货"
          ? supply ? "交期约四周，按批确认到货计划。" : "可接受排期，请回复预计到货周和付款条件。"
          : (supply ? spotSupply : spotDemand)[(sample + day) % spotSupply.length];
      const at = new Date(firstTime + Math.floor((lastTime - firstTime) * slot / 49)).toISOString();
      const nonce = prefix + date + "-" + String(slot).padStart(2, "0");
      inserted += Number(save.run(
        "demo-" + digest(owner + nonce).slice(0, 28), owner, nonce, supply ? "供应" : "求购",
        model, quantity, city, mode, supply ? "受托供货" : "受托采购", mode === "租赁" ? "租赁方" : "贸易商",
        "", terms, at, expiresAt, at, "", profiles[(index * 17) % profiles.length],
      ).changes);
    }
  }
  const totals = db.prepare(`SELECT substr(nonce, ?, 10) AS date,count(*) AS total
    FROM posts WHERE owner=? AND demoAuthor IS NOT NULL AND nonce BETWEEN ? AND ? GROUP BY date ORDER BY date`)
    .all(prefix.length + 1, owner, prefix + shanghaiDay(endDay - 14 * DAY), prefix + endDate + "~");
  if (totals.length !== 15 || totals.some(day => day.total !== 50)) throw new Error("Demo batch count mismatch.");
  if (inserted) db.exec("INSERT INTO revision VALUES ('feed',1) ON CONFLICT(id) DO UPDATE SET n=n+1");
  db.exec("COMMIT");
  console.log(JSON.stringify({ inserted, profiles: profiles.length, referencedModels: referenced.length, totals }));
} catch (error) {
  if (db.isTransaction) db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
