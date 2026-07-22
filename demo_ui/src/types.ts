/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum WorkspaceMode {
  PERSONAL = "PERSONAL",
  ENTERPRISE = "ENTERPRISE",
}

export enum EvidenceLevel {
  L0_ORAL = "L0", // 口头货源 (Only chat/oral text, no evidence)
  L1_IMAGE = "L1", // 图片货源 (Has equipment photos or quote screenshots)
  L2_VERIFIED = "L2", // 可验证货源 (Has SN, nameplate photos, BMC log or video)
  L3_TRANSACTABLE = "L3", // 可交易货源 (Has supply contract, invoice or verified authority)
  L4_INSPECTED = "L4", // 已验货货源 (Passed third-party test or onsite load test)
}

export enum StockStatus {
  TO_VERIFY = "TO_VERIFY",     // 待核实
  CONFIRMED = "CONFIRMED",     // 已确认
  QUOTABLE = "QUOTABLE",       // 可报价
  LOCKED = "LOCKED",           // 锁货中
  PARTIAL_SOLD = "PARTIAL_SOLD", // 部分售出
  SOLD_OUT = "SOLD_OUT",       // 已售罄
  EXPIRED = "EXPIRED",         // 已失效
}

export enum DealStage {
  CONTACT = "CONTACT",           // 初步接触
  CONFIRM_DEMAND = "CONFIRM",    // 需求确认
  MATCH_STOCK = "MATCH",         // 货源匹配
  QUOTED = "QUOTED",             // 已报价
  INTERESTED = "INTERESTED",     // 买家有意向
  LOCKED = "LOCKED",             // 锁货中
  INSPECTING = "INSPECTING",     // 验货中
  CONTRACT = "CONTRACT",         // 合同中
  PAYING = "PAYING",             // 待付款/付款中
  DELIVERING = "DELIVERING",     // 交付中
  CLOSED_WON = "CLOSED_WON",     // 已成交
  CLOSED_LOST = "CLOSED_LOST",   // 已失败
}

export interface ContactLink {
  id: string;
  name: string;
  company: string;
  phone?: string;
  wechat?: string;
  role: "OWNER" | "CHANNEL" | "MIDDLEMAN" | "BUYER" | "ME";
  commission?: number; // 佣金约定
  canDirectContact: boolean; // 是否可直接联系
  bypassProtection: "SECURE" | "RISKY" | "WARNING"; // 防绕单状态
}

export interface ServerSpec {
  gpuModel: string;        // GPU型号 e.g. H100, H200, B200, B300, H20, RTX 4090
  gpuQty: number;          // GPU数量 (e.g., 8, 4, 1)
  formFactor: string;      // 设备形态: SXM整机, PCIe, HGX模组, NVL72, 8卡整机, etc.
  brand: string;           // 品牌: 超微 Supermicro, 浪潮 Inspur, 戴尔 Dell, 惠普 HP, 华硕, 自研
  modelName: string;       // 整机型号 e.g. SYS-821GE-TNHR, NF5488M6
  cpu: string;             // CPU型号
  memory: string;          // 内存配置 e.g. 2TB DDR5
  ssd: string;             // SSD存储 e.g. 3.84TB * 4 NVMe
  networkCard: string;     // 网卡/IB网卡 e.g. Mellanox ConnectX-7 NDR 400G * 8
  cooling: "AIR" | "LIQUID" | "UNKNOWN"; // 风冷/液冷/未知
  powerSupply: string;     // 电源规格 e.g. 3000W * 4
  warranty: string;        // 质保状态
}

export interface StockNote {
  id: string;
  workspaceId: string;     // 关联空间 (PERSONAL or Enterprise ID)
  spec: ServerSpec;
  quantity: number;        // 总数量 (台)
  availableQty: number;   // 可售数量
  location: string;        // 所在地 (深圳, 香港, 泰国, 台湾, etc.)
  deliveryDays: string;    // 交期
  stockType: "READY" | "NEAR_READY" | "FUTURE"; // 现货/准现货/期货
  condition: "SEALED" | "UNSEALED" | "USED" | "DECOMMISSIONED"; // 原封/拆封/二手/退役
  minOrderQty: number;     // 最小起订量

  // 价格体系
  ownerPrice: number;      // 货主底价 (仅自用可见)
  purchaseCost: number;    // 我方成本价 (仅内部可见)
  quotedPrice: number;     // 对外报价 (可转发分享)
  expectedCommission: number; // 预计佣金 (仅自己可见)
  isTaxInclusive: boolean; // 是否含税
  taxType: string;         // 发票类型 (如 13%增专, 普票, 不开票)
  currency: string;        // 币种 (CNY, USD, etc.)
  paymentTerms: string;    // 付款条件 (如 30-70)
  validUntil?: string;     // 报价有效期

  // 链条
  contactChain: ContactLink[]; // 货权流转链条 (货主 -> 一级渠道 -> 居间人 -> 我)
  evidenceLevel: EvidenceLevel;
  evidenceFiles: {
    name: string;
    type: "PHOTO" | "SN_LIST" | "TEST_REPORT" | "BMC_LOG" | "CONTRACT" | "INVOICE";
    url: string;
    uploadTime: string;
  }[];

  status: StockStatus;
  createdAt: string;
  updatedAt: string;
  creatorId: string;
  creatorName: string;
  notes?: string;          // 原始录入文本/备注
  aiAnalysis?: string;     // AI分析结论 (配置冲突、信息不完整等)
}

export interface Demand {
  id: string;
  workspaceId: string;
  gpuModel: string;
  formFactor: string;
  quantity: number;
  location: string;
  targetPrice?: number;
  currency: string;
  conditionPreference: string; // 货态偏好
  deliveryTimeline: string;    // 期望交期
  buyerName: string;
  buyerContact?: string;
  status: "ACTIVE" | "MATCHED" | "PAUSED" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  creatorId: string;
  creatorName: string;
}

export interface Deal {
  id: string;
  workspaceId: string;
  name: string; // 项目名称 e.g. 某数据中心H200采购
  buyerName: string;
  buyerCompany: string;
  buyerContact: string;
  demandId?: string; // 关联的求购
  stockNoteId?: string; // 关联的选中货单
  stage: DealStage;
  ownerId: string;
  ownerName: string;
  currentBlocker?: string; // 当前卡点
  nextStep?: string;       // 下一步动作
  deadline?: string;       // 截止时间
  expectedRevenue?: number; // 预期销售额
  expectedProfit?: number;  // 预期毛利
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  workspaceId: string; // PERSONAL or Enterprise ID
  name: string;
  company: string;
  phone?: string;
  wechat?: string;
  roles: ("OWNER" | "CHANNEL" | "MIDDLEMAN" | "BUYER" | "VND")[]; // 角色
  products: string[]; // 负责设备/型号 e.g. H100, B200
  region: string; // 所在地
  credibility: "HIGH" | "MEDIUM" | "LOW"; // 信誉度
  notes?: string;
  creatorId: string;
  creatorName: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  action: string; // e.g. "创建货单", "修改底价", "导出报价单"
  details: string; // 详细信息 e.g. "修改货单 H200 (10台) 货主底价为 425万元/台"
  time: string;
  ip?: string;
}

export interface Approval {
  id: string;
  workspaceId: string;
  type: "LOW_MARGIN" | "CUSTOM_QUOTE" | "PRICE_CHANGE"; // 超低毛利审批 | 订制报价审批 | 价格变更审批
  stockNoteId: string;
  dealId?: string;
  requesterId: string;
  requesterName: string;
  details: string; // e.g. "对外售价 420万 (毛利率 2.4%，低于公司预警线 3%)"
  status: "PENDING" | "APPROVED" | "REJECTED";
  approverId?: string;
  approverName?: string;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}
