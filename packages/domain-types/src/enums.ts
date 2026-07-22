/**
 * 货记 · 领域枚举与状态机（总体设计说明书 第 9/15 章）
 * 前后端唯一权威定义。demo_ui 原型中的旧枚举以此为准替换。
 */

// ===== 工作空间（6.2）=====
export enum WorkspaceType {
  PERSONAL = 'PERSONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum MembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  LEFT = 'LEFT', // 离职只改状态，禁止删除
}

export enum DataScope {
  SELF = 'SELF',
  DEPARTMENT = 'DEPARTMENT',
  PROJECT_GROUP = 'PROJECT_GROUP',
  WORKSPACE = 'WORKSPACE',
  CUSTOM = 'CUSTOM',
}

// ===== 数据密级与可见范围（第 9 章）=====
export enum DataClassification {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL',
  CONFIDENTIAL = 'CONFIDENTIAL',
  STRICT_CONFIDENTIAL = 'STRICT_CONFIDENTIAL',
}

export enum VisibilityScope {
  PRIVATE = 'PRIVATE',
  OWNER_ONLY = 'OWNER_ONLY',
  DEPARTMENT = 'DEPARTMENT',
  PROJECT = 'PROJECT',
  WORKSPACE = 'WORKSPACE',
  CUSTOM = 'CUSTOM',
}

// ===== 货源状态机（15.1）=====
export enum GoodsOfferStatus {
  DRAFT = 'DRAFT',
  PARSING = 'PARSING',
  NEED_CONFIRMATION = 'NEED_CONFIRMATION',
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
  SELLABLE = 'SELLABLE',
  RESERVED = 'RESERVED',
  PARTIALLY_SOLD = 'PARTIALLY_SOLD',
  SOLD_OUT = 'SOLD_OUT',
  EXPIRED = 'EXPIRED',
  INVALID = 'INVALID',
  CANCELLED = 'CANCELLED',
}

/** 15.1 允许的状态流转表；应用层唯一校验入口 */
export const GOODS_STATUS_TRANSITIONS: Record<GoodsOfferStatus, GoodsOfferStatus[]> = {
  [GoodsOfferStatus.DRAFT]: [GoodsOfferStatus.PARSING, GoodsOfferStatus.CANCELLED],
  [GoodsOfferStatus.PARSING]: [GoodsOfferStatus.NEED_CONFIRMATION],
  [GoodsOfferStatus.NEED_CONFIRMATION]: [GoodsOfferStatus.UNVERIFIED, GoodsOfferStatus.CANCELLED],
  [GoodsOfferStatus.UNVERIFIED]: [GoodsOfferStatus.VERIFIED, GoodsOfferStatus.INVALID],
  [GoodsOfferStatus.VERIFIED]: [GoodsOfferStatus.SELLABLE, GoodsOfferStatus.INVALID],
  [GoodsOfferStatus.SELLABLE]: [GoodsOfferStatus.RESERVED, GoodsOfferStatus.EXPIRED],
  [GoodsOfferStatus.RESERVED]: [GoodsOfferStatus.SELLABLE, GoodsOfferStatus.PARTIALLY_SOLD],
  [GoodsOfferStatus.PARTIALLY_SOLD]: [GoodsOfferStatus.SOLD_OUT],
  [GoodsOfferStatus.SOLD_OUT]: [],
  [GoodsOfferStatus.EXPIRED]: [],
  [GoodsOfferStatus.INVALID]: [],
  [GoodsOfferStatus.CANCELLED]: [],
};

export enum GoodsRecordType {
  MARKET_LEAD = 'MARKET_LEAD',
  CONTROLLED_STOCK = 'CONTROLLED_STOCK',
}

export enum VerificationLevel {
  L0 = 'L0', // 口头或纯文字
  L1 = 'L1', // 有图片或报价截图
  L2 = 'L2', // 有 SN、铭牌、实时视频或 BMC
  L3 = 'L3', // 有货权、合同、发票或主体证明
  L4 = 'L4', // 已完成现场或第三方验货
}

export enum PriceType {
  OWNER_PRICE = 'OWNER_PRICE',       // 敏感
  COST_PRICE = 'COST_PRICE',         // 敏感
  EXTERNAL_PRICE = 'EXTERNAL_PRICE', // 对外
}

export enum QuantityChangeReason {
  INITIAL = 'INITIAL',
  UPDATED_BY_SOURCE = 'UPDATED_BY_SOURCE',
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
  SOLD = 'SOLD',
  EXPIRED = 'EXPIRED',
  MANUAL_CORRECTION = 'MANUAL_CORRECTION',
}

// ===== 求购状态机（15.2）=====
export enum DemandStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  MATCHING = 'MATCHING',
  CANDIDATES_FOUND = 'CANDIDATES_FOUND',
  QUOTED = 'QUOTED',
  NEGOTIATING = 'NEGOTIATING',
  FULFILLED = 'FULFILLED',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

// ===== 报价状态机（15.3）=====
export enum QuoteStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SENT = 'SENT',       // 已发送禁止修改，只能新版本
  VIEWED = 'VIEWED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

// ===== 交易项目状态机（15.4，二/三期启用）=====
export enum DealStage {
  LEAD = 'LEAD',
  QUALIFIED = 'QUALIFIED',
  MATCHING = 'MATCHING',
  QUOTING = 'QUOTING',
  NEGOTIATING = 'NEGOTIATING',
  RESERVING = 'RESERVING',
  INSPECTION = 'INSPECTION',
  CONTRACTING = 'CONTRACTING',
  PAYMENT = 'PAYMENT',
  DELIVERY = 'DELIVERY',
  ACCEPTANCE = 'ACCEPTANCE',
  WON = 'WON',
  LOST = 'LOST',
  CANCELLED = 'CANCELLED',
}

// ===== 验货状态机（15.5，三期启用）=====
export enum InspectionStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PASSED = 'PASSED',
  CONDITIONAL_PASSED = 'CONDITIONAL_PASSED',
  REINSPECTION_REQUIRED = 'REINSPECTION_REQUIRED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ===== 主体（10.6）=====
export enum PartyRole {
  OWNER = 'OWNER',
  SUPPLIER = 'SUPPLIER',
  CHANNEL = 'CHANNEL',
  BROKER = 'BROKER',
  BUYER = 'BUYER',
  PROCUREMENT = 'PROCUREMENT',
  INSPECTOR = 'INSPECTOR',
  LOGISTICS = 'LOGISTICS',
  SERVICE_PROVIDER = 'SERVICE_PROVIDER',
}

export enum PartyRelationType {
  INTRODUCED_BY = 'INTRODUCED_BY',
  CONTROLS = 'CONTROLS',
  WORKS_FOR = 'WORKS_FOR',
  COOPERATES_WITH = 'COOPERATES_WITH',
}

// ===== 采集（10.8）=====
export enum CaptureType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
}

export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

// ===== 共享镜像（10.23 / 17 章）=====
export enum SyncPolicy {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
  NOTIFY_ONLY = 'NOTIFY_ONLY',
}

export enum ShareStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

// ===== 任务（10.24）=====
export enum TaskStatus {
  TODO = 'TODO',
  DOING = 'DOING',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}
