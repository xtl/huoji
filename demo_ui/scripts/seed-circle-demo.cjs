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
  ["A100", "A100 80G 8 卡整机", "台", [2, 4, 8, 16]],
  ["A800", "A800 80G 8 卡整机", "台", [2, 4, 8]],
  ["910C", "昇腾 910C 整机", "台", [2, 4, 8]],
  ["DDR4", "64GB DDR4 3200 服务器内存", "条", [20, 40, 80, 120]],
  ["DDR5", "64GB DDR5 6400 服务器内存", "条", [32, 64, 128, 200]],
];
const memorySpecs = [
  ["DDR4", "三星 64GB DDR4 3200 ECC RDIMM", "条", [20, 40, 80, 120]],
  ["DDR4", "SK 海力士 32GB DDR4 3200 ECC RDIMM", "条", [24, 48, 96, 192]],
  ["DDR4", "美光 128GB DDR4 3200 ECC LRDIMM", "条", [16, 32, 64]],
  ["DDR5", "SK 海力士 64GB DDR5 6400 ECC RDIMM", "条", [32, 64, 128, 200]],
  ["DDR5", "三星 32GB DDR5 5600 ECC RDIMM", "条", [20, 40, 80, 160]],
  ["DDR5", "美光 96GB DDR5 5600 ECC RDIMM", "条", [16, 32, 64, 128]],
  ["DDR5", "三星 128GB DDR5 5600 ECC RDIMM", "条", [16, 32, 64]],
];
const cities = [["深圳", 30], ["上海", 7], ["北京", 7], ["杭州", 6]]
  .flatMap(([city, count]) => Array(count).fill(city));
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
const serverMix = [...referenced, ...products].filter(([, , unit]) => unit === "台" || unit === "柜");
const rentalMix = serverMix.filter(([, , unit]) => unit === "台");
const memoryMix = [...memorySpecs.filter(([model]) => scores.get(model) > 0), ...memorySpecs];
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
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,nonce) DO UPDATE SET
      kind=excluded.kind, title=excluded.title, quantity=excluded.quantity, city=excluded.city, mode=excluded.mode,
      role=excluded.role, businessRole=excluded.businessRole, terms=excluded.terms
    WHERE posts.demoAuthor IS NOT NULL AND
      (posts.kind,posts.title,posts.quantity,posts.city,posts.mode,posts.role,posts.businessRole,posts.terms)
      IS NOT (excluded.kind,excluded.title,excluded.quantity,excluded.city,excluded.mode,excluded.role,excluded.businessRole,excluded.terms)`);
  const existing = db.prepare("SELECT 1 FROM posts WHERE owner=? AND nonce=?");
  const expiresAt = new Date(endDay + 31 * DAY).toISOString();
  let inserted = 0;
  let updated = 0;
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
      const category = sample < 25 ? "memory" : sample < 35 ? "rental" : "server";
      const mix = category === "memory" ? memoryMix : category === "rental" ? rentalMix : serverMix;
      const [, model, unit, quantities] = mix[(sample + day * 3) % mix.length];
      const quantity = quantities[(sample + day) % quantities.length] + unit;
      const city = cities[(slot * 23 + day * 13) % cities.length];
      const mode = category === "rental" ? "租赁" : sample % 7 === 0 ? "期货" : "现货";
      const terms = mode === "租赁"
        ? supply ? "月租，可安排上架，电费另计。" : "先租三个月，请报月租、机房位置及电费。"
        : mode === "期货"
          ? supply ? "交期约四周，按批确认到货计划。" : "可接受排期，请回复预计到货周和付款条件。"
          : (supply ? spotSupply : spotDemand)[(sample + day) % spotSupply.length];
      const at = new Date(firstTime + Math.floor((lastTime - firstTime) * slot / 49)).toISOString();
      const nonce = prefix + date + "-" + String(slot).padStart(2, "0");
      const wasPresent = existing.get(owner, nonce);
      const changes = Number(save.run(
        "demo-" + digest(owner + nonce).slice(0, 28), owner, nonce, supply ? "供应" : "求购",
        model, quantity, city, mode, supply ? "受托供货" : "受托采购", mode === "租赁" ? "租赁方" : "贸易商",
        "", terms, at, expiresAt, at, "", profiles[(index * 17) % profiles.length],
      ).changes);
      if (wasPresent) updated += changes;
      else inserted += changes;
    }
  }
  const totals = db.prepare(`SELECT substr(nonce, ?, 10) AS date,count(*) AS total,
    sum(title LIKE '%RDIMM') AS memory, sum(mode='租赁') AS rental,
    sum(mode <> '租赁' AND title NOT LIKE '%RDIMM') AS servers,
    sum(city='深圳') AS shenzhen, sum(city='上海') AS shanghai,
    sum(city='北京') AS beijing, sum(city='杭州') AS hangzhou
    FROM posts WHERE owner=? AND demoAuthor IS NOT NULL AND nonce BETWEEN ? AND ? GROUP BY date ORDER BY date`)
    .all(prefix.length + 1, owner, prefix + shanghaiDay(endDay - 14 * DAY), prefix + endDate + "~");
  const expected = { total: 50, memory: 25, rental: 10, servers: 15, shenzhen: 30, shanghai: 7, beijing: 7, hangzhou: 6 };
  if (totals.length !== 15 || totals.some(day => Object.entries(expected).some(([key, value]) => day[key] !== value))) {
    throw new Error("Demo batch distribution mismatch.");
  }
  if (inserted || updated) db.exec("INSERT INTO revision VALUES ('feed',1) ON CONFLICT(id) DO UPDATE SET n=n+1");
  db.exec("COMMIT");
  console.log(JSON.stringify({ inserted, updated, profiles: profiles.length, referencedModels: referenced.length, totals }));
} catch (error) {
  if (db.isTransaction) db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
