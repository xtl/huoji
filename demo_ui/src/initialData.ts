/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StockNote, Demand, Contact, Deal, AuditLog, Approval, StockStatus, EvidenceLevel, DealStage } from "./types";

export const initialStockNotes: StockNote[] = [
  {
    id: "stock-1",
    workspaceId: "personal",
    spec: {
      gpuModel: "NVIDIA H200 SXM",
      gpuQty: 8,
      formFactor: "SXM整机",
      brand: "Supermicro (超微)",
      modelName: "SYS-821GE-TNHR",
      cpu: "Intel Xeon Platinum 8480+ * 2 (56核)",
      memory: "2TB DDR5 Reg ECC",
      ssd: "3.84TB NVMe SSD * 4",
      networkCard: "Mellanox ConnectX-7 NDR 400Gb * 8",
      cooling: "AIR",
      powerSupply: "3000W * 4 Platinum Redundant",
      warranty: "原厂3年保修，2026年开始"
    },
    quantity: 10,
    availableQty: 10,
    location: "深圳现货",
    deliveryDays: "现货，验机通过后2天内发货",
    stockType: "READY",
    condition: "SEALED",
    minOrderQty: 1,
    ownerPrice: 415.0, // 万 RMB
    purchaseCost: 420.0, // 万 RMB
    quotedPrice: 430.0, // 万 RMB
    expectedCommission: 10.0, // 万 RMB
    isTaxInclusive: true,
    taxType: "13%增值税专用发票",
    currency: "CNY",
    paymentTerms: "30%预付，70%现场验机后付清发货",
    contactChain: [
      { id: "c-1", name: "老陈", company: "星云算力科技", role: "OWNER", canDirectContact: false, bypassProtection: "SECURE" },
      { id: "c-2", name: "张总", company: "深算中介联合", role: "MIDDLEMAN", canDirectContact: true, bypassProtection: "SECURE" }
    ],
    evidenceLevel: EvidenceLevel.L2_VERIFIED,
    evidenceFiles: [
      { name: "server_body.jpg", type: "PHOTO", url: "#", uploadTime: "2026-07-20 14:00" },
      { name: "sn_list_h200.txt", type: "SN_LIST", url: "#", uploadTime: "2026-07-20 14:05" },
      { name: "bmc_log_sys821.log", type: "BMC_LOG", url: "#", uploadTime: "2026-07-20 14:10" }
    ],
    status: StockStatus.CONFIRMED,
    createdAt: "2026-07-20T14:00:00-07:00",
    updatedAt: "2026-07-21T10:00:00-07:00",
    creatorId: "user-1",
    creatorName: "徐销售",
    notes: "老陈手头的深圳现货，超微8卡H200整机，带八张400G网卡。实物SN核验过，未在其他平台重复上架，可信度高。张总在里面吃5000元茶水费。"
  },
  {
    id: "stock-2",
    workspaceId: "personal",
    spec: {
      gpuModel: "NVIDIA H100 SXM",
      gpuQty: 8,
      formFactor: "SXM整机",
      brand: "Inspur (浪潮)",
      modelName: "NF5488M6",
      cpu: "Intel Xeon Platinum 8358 * 2 (32核)",
      memory: "1TB DDR4 Reg ECC",
      ssd: "3.84TB NVMe SSD * 2",
      networkCard: "Mellanox ConnectX-6 VPI 200Gb * 8",
      cooling: "AIR",
      powerSupply: "3000W * 4 Platinum",
      warranty: "在保二手（保修期至2027年）"
    },
    quantity: 5,
    availableQty: 5,
    location: "香港机房",
    deliveryDays: "3-5天国内交付，免税包双清",
    stockType: "READY",
    condition: "USED",
    minOrderQty: 2,
    ownerPrice: 280.0,
    purchaseCost: 285.0,
    quotedPrice: 298.0,
    expectedCommission: 13.0,
    isTaxInclusive: false,
    taxType: "不开票（香港离岸价格）",
    currency: "CNY",
    paymentTerms: "20%锁货定金，80%香港本地交付或国内清关完毕付清",
    contactChain: [
      { id: "c-3", name: "王销售", company: "香港德信科技", role: "OWNER", canDirectContact: true, bypassProtection: "SECURE" }
    ],
    evidenceLevel: EvidenceLevel.L1_IMAGE,
    evidenceFiles: [
      { name: "packing_box.jpg", type: "PHOTO", url: "#", uploadTime: "2026-07-19 11:30" }
    ],
    status: StockStatus.QUOTABLE,
    createdAt: "2026-07-19T11:30:00-07:00",
    updatedAt: "2026-07-21T15:20:00-07:00",
    creatorId: "user-1",
    creatorName: "徐销售",
    notes: "香港二手货，箱子还在，浪潮NF5488M6。客户已退网，机器健康度通过24小时压力测试。注意：已有别家销售也在传这套货，有撞单嫌疑。"
  },
  {
    id: "stock-3",
    workspaceId: "enterprise-1",
    spec: {
      gpuModel: "NVIDIA B200 NVL",
      gpuQty: 8,
      formFactor: "HGX模组",
      brand: "Supermicro (超微)",
      modelName: "SYS-821GE-B200",
      cpu: "Intel Xeon Platinum 5代 Scalable * 2",
      memory: "4TB DDR5 ECC",
      ssd: "7.68TB NVMe SSD * 4",
      networkCard: "Mellanox ConnectX-8 NDR 800Gb * 8",
      cooling: "LIQUID",
      powerSupply: "4500W * 4 Platinum Redundant",
      warranty: "原厂三年，金牌上门"
    },
    quantity: 16,
    availableQty: 16,
    location: "新加坡交付",
    deliveryDays: "期货，8月下旬发货",
    stockType: "FUTURE",
    condition: "SEALED",
    minOrderQty: 4,
    ownerPrice: 485.0,
    purchaseCost: 495.0,
    quotedPrice: 510.0,
    expectedCommission: 15.0,
    isTaxInclusive: true,
    taxType: "免税CIF条件",
    currency: "USD",
    paymentTerms: "50%开信用证(LC)，50%装船交付前电汇(TT)",
    contactChain: [
      { id: "c-4", name: "Somchai", company: "Siam Compute Group", role: "CHANNEL", canDirectContact: false, bypassProtection: "RISKY" }
    ],
    evidenceLevel: EvidenceLevel.L3_TRANSACTABLE,
    evidenceFiles: [
      { name: "purchase_order_siam.pdf", type: "CONTRACT", url: "#", uploadTime: "2026-07-21 09:12" }
    ],
    status: StockStatus.QUOTABLE,
    createdAt: "2026-07-21T09:12:00-07:00",
    updatedAt: "2026-07-21T09:12:00-07:00",
    creatorId: "user-1",
    creatorName: "徐销售",
    notes: "泰国Somchai介绍的新加坡B200期货。货源来自原厂渠道，有正规采购订单凭证。该货权由我司独家跟进，利润空间大，正在申请销售总监审批报价权限。"
  },
  {
    id: "stock-4",
    workspaceId: "enterprise-1",
    spec: {
      gpuModel: "NVIDIA H20 PCIe",
      gpuQty: 8,
      formFactor: "SXM整机",
      brand: "Inspur (浪潮)",
      modelName: "NF5468M6",
      cpu: "Intel Xeon Platinum 8352Y * 2",
      memory: "512GB DDR4",
      ssd: "3.84TB SSD * 2",
      networkCard: "ConnectX-6 Dx 100Gb * 4",
      cooling: "AIR",
      powerSupply: "2000W * 4",
      warranty: "原厂质保，剩余18个月"
    },
    quantity: 32,
    availableQty: 32,
    location: "北京顺义机房",
    deliveryDays: "现货，3天内完成上架或提货",
    stockType: "READY",
    condition: "USED",
    minOrderQty: 8,
    ownerPrice: 110.0,
    purchaseCost: 112.0,
    quotedPrice: 118.0,
    expectedCommission: 6.0,
    isTaxInclusive: true,
    taxType: "13%增值税专用发票",
    currency: "CNY",
    paymentTerms: "一次性付清，支持上门验货",
    contactChain: [
      { id: "c-5", name: "马总", company: "北方智算物联", role: "OWNER", canDirectContact: true, bypassProtection: "SECURE" }
    ],
    evidenceLevel: EvidenceLevel.L4_INSPECTED,
    evidenceFiles: [
      { name: "test_report_h20.pdf", type: "TEST_REPORT", url: "#", uploadTime: "2026-07-18 10:20" },
      { name: "onsite_audit.jpg", type: "PHOTO", url: "#", uploadTime: "2026-07-18 10:25" }
    ],
    status: StockStatus.LOCKED,
    createdAt: "2026-07-18T10:20:00-07:00",
    updatedAt: "2026-07-21T18:00:00-07:00",
    creatorId: "user-2",
    creatorName: "王经理",
    notes: "北京顺义现货H20八卡机器。第三方服务商已做完测试报告，无任何降频或报错。目前已被深圳数据中心客户锁定，等待付尾款。"
  }
];

export const initialDemands: Demand[] = [
  {
    id: "demand-1",
    workspaceId: "personal",
    gpuModel: "NVIDIA H200 SXM",
    formFactor: "8卡整机",
    quantity: 16,
    location: "深圳或香港机房",
    targetPrice: 425.0,
    currency: "CNY",
    conditionPreference: "新机原封或成色优的在保二手",
    deliveryTimeline: "7月底前交付",
    buyerName: "李总（深圳某中型数据中心）",
    buyerContact: "微信: dynamic-li",
    status: "ACTIVE",
    createdAt: "2026-07-20T16:00:00-07:00",
    updatedAt: "2026-07-21T11:00:00-07:00",
    creatorId: "user-1",
    creatorName: "徐销售"
  },
  {
    id: "demand-2",
    workspaceId: "enterprise-1",
    gpuModel: "NVIDIA H100 SXM",
    formFactor: "SXM整机",
    quantity: 8,
    location: "香港本地机房",
    targetPrice: 295.0,
    currency: "CNY",
    conditionPreference: "二手在保即可，要有BMC系统日志",
    deliveryTimeline: "立即需要",
    buyerName: "泰国算力集成商 - Prachai",
    buyerContact: "Email: prachai@compute.th",
    status: "ACTIVE",
    createdAt: "2026-07-21T10:00:00-07:00",
    updatedAt: "2026-07-21T10:00:00-07:00",
    creatorId: "user-2",
    creatorName: "王经理"
  }
];

export const initialContacts: Contact[] = [
  {
    id: "c-1",
    workspaceId: "personal",
    name: "老陈",
    company: "星云算力科技",
    phone: "13912345678",
    wechat: "chen_compute_pro",
    roles: ["OWNER", "CHANNEL"],
    products: ["H200 SXM", "H100 SXM", "B200"],
    region: "广东深圳",
    credibility: "HIGH",
    notes: "真实现货大佬，一般自己不群发，消息可信。打交道两年多，做事爽快。",
    creatorId: "user-1",
    creatorName: "徐销售",
    createdAt: "2026-05-12T10:00:00-07:00"
  },
  {
    id: "c-2",
    workspaceId: "personal",
    name: "张总",
    company: "深算中介联合",
    phone: "13588889999",
    wechat: "broker-zhang-sz",
    roles: ["MIDDLEMAN"],
    products: ["Nvidia 全系列"],
    region: "广东深圳",
    credibility: "MEDIUM",
    notes: "资深服务器老掮客，朋友圈各种拼缝。拿他手里的货源要小心核对，大概率经过了3手以上，但人脉确实广。",
    creatorId: "user-1",
    creatorName: "徐销售",
    createdAt: "2026-06-01T14:30:00-07:00"
  },
  {
    id: "c-3",
    workspaceId: "personal",
    name: "王销售",
    company: "香港德信科技",
    phone: "+852 9123 4567",
    wechat: "hkwang_hardware",
    roles: ["OWNER"],
    products: ["H100 二手机器", "A100", "L40S"],
    region: "中国香港",
    credibility: "HIGH",
    notes: "负责机房退网及清收，拿货价格优势明显，全款交易，发货迅速。",
    creatorId: "user-1",
    creatorName: "徐销售",
    createdAt: "2026-03-10T09:00:00-07:00"
  },
  {
    id: "c-4",
    workspaceId: "enterprise-1",
    name: "Somchai",
    company: "Siam Compute Group",
    phone: "+66 81 234 5678",
    wechat: "somchai_th_compute",
    roles: ["CHANNEL", "MIDDLEMAN"],
    products: ["B200 NVL", "B300"],
    region: "泰国曼谷",
    credibility: "MEDIUM",
    notes: "东南亚大集成商买手兼渠道，喜欢吃佣金。警惕他过早把配置单给到最终买家导致我们被绕单。",
    creatorId: "user-1",
    creatorName: "徐销售",
    createdAt: "2026-07-02T16:00:00-07:00"
  },
  {
    id: "c-5",
    workspaceId: "enterprise-1",
    name: "马总",
    company: "北方智算物联",
    phone: "18622223333",
    wechat: "ma_bj_compute",
    roles: ["OWNER"],
    products: ["H20 PCIe", "A800", "4090单卡"],
    region: "北京",
    credibility: "HIGH",
    notes: "北京机房合伙人，自己手里有设备和合同，随时配合现场看货，交易极其靠谱。",
    creatorId: "user-2",
    creatorName: "王经理",
    createdAt: "2026-01-15T11:00:00-07:00"
  }
];

export const initialDeals: Deal[] = [
  {
    id: "deal-1",
    workspaceId: "personal",
    name: "深圳高斯智算中心H200项目",
    buyerName: "李总",
    buyerCompany: "深圳高斯算力科技有限公司",
    buyerContact: "微信: dynamic-li",
    demandId: "demand-1",
    stockNoteId: "stock-1",
    stage: DealStage.INSPECTING,
    ownerId: "user-1",
    ownerName: "徐销售",
    currentBlocker: "正在等待货主提供完整的设备BMC测试日志和风扇健康度截图",
    nextStep: "今日下午18:00前，督促张总找老陈索要BMC日志并转交给李总",
    deadline: "2026-07-22",
    expectedRevenue: 6880.0, // 430 * 16台
    expectedProfit: 160.0, // (430 - 420) * 16台
    createdAt: "2026-07-21T09:00:00Z",
    updatedAt: "2026-07-21T09:00:00Z"
  },
  {
    id: "deal-2",
    workspaceId: "enterprise-1",
    name: "泰国Prachai H100二手服务器采购",
    buyerName: "Prachai",
    buyerCompany: "Thaisoft AI Solution",
    buyerContact: "Email: prachai@compute.th",
    demandId: "demand-2",
    stockNoteId: "stock-2",
    stage: DealStage.QUOTED,
    ownerId: "user-1",
    ownerName: "徐销售",
    currentBlocker: "客户对香港二手设备的剩余质保期限有些顾虑，希望我们能代买一年原厂联保服务",
    nextStep: "找香港王销售查询是否可以向原厂补买延长保修，以及补买保修需要多少成本",
    deadline: "2026-07-24",
    expectedRevenue: 2384.0, // 298 * 8台
    expectedProfit: 104.0, // (298 - 285) * 8台
    createdAt: "2026-07-21T10:15:00Z",
    updatedAt: "2026-07-21T10:15:00Z"
  }
];

export const initialAuditLogs: AuditLog[] = [
  {
    id: "log-1",
    workspaceId: "enterprise-1",
    userId: "user-1",
    userName: "徐销售",
    action: "创建货单",
    details: "通过聊天记录一键AI识别创建了'NVIDIA B200 NVL (16台)'货单，设定对外报价 510万元/台，货主底价 485万元/台",
    time: "2026-07-21 09:12:15",
    ip: "192.168.1.102"
  },
  {
    id: "log-2",
    workspaceId: "enterprise-1",
    userId: "user-1",
    userName: "徐销售",
    action: "报价脱敏导出",
    details: "导出了 H200 Supermicro SYS-821GE 10台 货源卡片（脱敏版，自动隐藏了真实底价和上游货主老陈的信息）",
    time: "2026-07-21 11:24:00",
    ip: "192.168.1.102"
  },
  {
    id: "log-3",
    workspaceId: "enterprise-1",
    userId: "user-2",
    userName: "王经理",
    action: "修改底价",
    details: "修改货单 H20 PCIe (32台) 的货主底价由 112万元 调整为 110万元，锁货状态不变",
    time: "2026-07-21 18:02:11",
    ip: "192.168.1.45"
  }
];

export const initialApprovals: Approval[] = [
  {
    id: "app-1",
    workspaceId: "enterprise-1",
    type: "LOW_MARGIN",
    stockNoteId: "stock-3",
    dealId: "deal-2",
    requesterId: "user-1",
    requesterName: "徐销售",
    details: "申请 B200 泰国项目报价为 500万美元（由于首批批量大，拟将毛利率降至1.8%，低于公司标准预警线3%）",
    status: "PENDING",
    createdAt: "2026-07-21 11:45:00",
    updatedAt: "2026-07-21 11:45:00"
  },
  {
    id: "app-2",
    workspaceId: "enterprise-1",
    type: "PRICE_CHANGE",
    stockNoteId: "stock-4",
    dealId: "deal-1",
    requesterId: "user-2",
    requesterName: "王经理",
    details: "申请调整 H20 PCIe 销售价格，由 118万/台 调至 116.5万/台，以匹配深圳机房一次性32台全款采购需求",
    status: "APPROVED",
    approverId: "user-admin",
    approverName: "张总经理",
    comment: "大客户全款进账，快速锁定周转，同意特批。",
    createdAt: "2026-07-21 15:30:00",
    updatedAt: "2026-07-21 15:45:00"
  }
];
