/**
 * 货记 · 核心实体类型（总体设计说明书 第 9/10/11 章）
 *
 * 权限裁剪原则（16.3）：敏感字段类型上标记为可选，后端按权限决定是否返回；
 * 无权限时字段【不出现】在响应中，而不是返回 null/hidden 标记。
 */
import {
  CaptureType,
  DataClassification,
  DemandStatus,
  GoodsOfferStatus,
  GoodsRecordType,
  PartyRole,
  PriceType,
  ProcessingStatus,
  QuantityChangeReason,
  QuoteStatus,
  ShareStatus,
  SyncPolicy,
  TaskStatus,
  VerificationLevel,
  VisibilityScope,
  WorkspaceType,
} from './enums';

/** 第 9 章统一字段规范 */
export interface BaseEntity {
  id: string;
  workspaceId: string;
  createdBy: string;
  updatedBy?: string;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
  /** 乐观锁版本；修改请求需携带 If-Match */
  version: number;
}

export interface SensitiveEntityFields {
  dataClassification: DataClassification;
  visibilityScope: VisibilityScope;
  departmentId?: string;
  projectGroupId?: string;
}

// ===== 空间 =====
export interface Workspace {
  id: string;
  type: WorkspaceType;
  name: string;
  ownerUserId?: string;
  organizationId?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  planCode: string;
}

// ===== 货源（10.10）=====
export interface GoodsOffer extends BaseEntity, SensitiveEntityFields {
  offerNo: string;
  title?: string;
  recordType: GoodsRecordType;
  direction: 'SELL' | 'SUPPLY';
  productCategory: 'SERVER' | 'GPU' | 'BASEBOARD' | 'PART';
  gpuModel?: string;
  gpuFormFactor?: 'SXM' | 'PCIE' | 'NVL' | 'HGX';
  gpuCount?: number;
  serverBrand?: string;
  serverModel?: string;
  cpuSpec?: Record<string, unknown>;
  memorySpec?: Record<string, unknown>;
  storageSpec?: Record<string, unknown>;
  networkSpec?: Record<string, unknown>;
  coolingType?: 'AIR' | 'LIQUID';
  quantityTotal?: number;
  quantityAvailable?: number;
  quantityUnit?: string;
  minimumOrderQuantity?: number;
  condition?: 'NEW' | 'USED' | 'REFURBISHED';
  packageStatus?: 'SEALED' | 'OPENED' | 'UNKNOWN';
  availabilityType?: 'SPOT' | 'NEAR_SPOT' | 'FUTURES';
  locationCountry?: string;
  locationProvince?: string;
  locationCity?: string;
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
  /** 敏感：实际货主，需 goods.read_supplier 权限 */
  ownerPartyId?: string;
  /** 敏感：信息来源，需 goods.read_supplier 权限 */
  sourcePartyId?: string;
  status: GoodsOfferStatus;
  verificationLevel: VerificationLevel;
  trustScore?: number;
  completenessScore?: number;
  freshnessAt?: string;
  expiresAt?: string;
  rawSummary?: string;
  normalizedSpec?: Record<string, unknown>;
  aiConfidence?: number;
  captureItemId?: string;
}

export interface GoodsPriceRecord {
  id: string;
  goodsOfferId: string;
  priceType: PriceType;
  amount: number;
  currency: string;
  unit: 'PER_UNIT' | 'TOTAL';
  taxIncluded?: boolean;
  taxRate?: number;
  validFrom: string;
  validUntil?: string;
  sourcePartyId?: string;
  createdBy: string;
  createdAt: string;
}

export interface GoodsQuantityRecord {
  id: string;
  goodsOfferId: string;
  quantityBefore?: number;
  quantityAfter: number;
  quantityDelta?: number;
  reason: QuantityChangeReason;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

// ===== 主体（10.5）=====
export interface Party extends BaseEntity {
  partyType: 'PERSON' | 'COMPANY';
  displayName: string;
  /** 敏感：应用层加密 */
  mobile?: string;
  email?: string;
  countryCode?: string;
  province?: string;
  city?: string;
  companyParentId?: string;
  source: 'MANUAL' | 'AI' | 'IMPORT';
  trustLevel?: string;
  notes?: string;
  roles?: PartyRole[];
  extra?: Record<string, unknown>;
}

// ===== 采集（10.8）=====
export interface CaptureItem {
  id: string;
  workspaceId: string;
  captureType: CaptureType;
  rawText?: string;
  fileId?: string;
  sourceChannel: 'WECHAT' | 'MANUAL' | 'IMPORT' | 'CAMERA';
  processingStatus: ProcessingStatus;
  targetType?: 'GOODS' | 'DEMAND' | 'CONTACT' | 'UNKNOWN';
  confirmed: boolean;
  createdBy: string;
  createdAt: string;
}

// ===== AI 抽取结果（第 11 章固定 JSON Schema）=====
export interface AiExtractionResult {
  intent: 'SELL_OFFER' | 'BUY_DEMAND' | 'CONTACT' | 'UNKNOWN';
  goods?: {
    product_category?: string;
    gpu_model?: string;
    gpu_form_factor?: string;
    gpu_count?: number;
    server_brand?: string;
    server_model?: string | null;
    cpu?: unknown[];
    memory?: unknown[];
    storage?: unknown[];
    network?: unknown[];
    quantity?: number;
    quantity_unit?: string;
    condition?: string;
    availability_type?: string;
    location?: { country?: string; province?: string; city?: string };
  };
  commercial?: {
    price?: number;
    currency?: string;
    price_unit?: string;
    tax_included?: boolean;
    tax_rate?: number | null;
    delivery_days_min?: number;
    delivery_days_max?: number;
    minimum_order_quantity?: number | null;
    valid_until?: string | null;
  };
  parties?: Array<{ name: string; role: string }>;
  requirements?: string[];
  missing_fields: string[];
  conflicts: Array<{ field: string; values: unknown[]; note?: string }>;
  field_confidence: Record<string, number>;
}

// ===== 求购（10.15）=====
export interface Demand extends BaseEntity {
  demandNo: string;
  buyerPartyId?: string;
  productCategory?: string;
  gpuModel?: string;
  gpuCount?: number;
  requiredSpec?: Record<string, unknown>;
  quantityRequired?: number;
  budgetMin?: number;
  budgetMax?: number;
  currency: string;
  taxRequired?: boolean;
  locationRequirement?: string;
  conditionRequirement?: string;
  warrantyRequirement?: string;
  inspectionRequirement?: string;
  deliveryDeadline?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: DemandStatus;
}

// ===== 报价（10.19-10.21）=====
export interface Quote extends BaseEntity {
  quoteNo: string;
  dealId?: string;
  buyerPartyId?: string;
  status: QuoteStatus;
  currentVersionNo: number;
  validUntil?: string;
  totalAmount?: number;
  currency: string;
  taxIncluded?: boolean;
  /** 敏感：需 quote.read_margin 权限 */
  marginAmount?: number;
  /** 敏感：需 quote.read_margin 权限 */
  marginRate?: number;
  approvalRequired: boolean;
  sentAt?: string;
  acceptedAt?: string;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  goodsOfferId?: string;
  itemName: string;
  specSnapshot?: Record<string, unknown>;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** 敏感：需 quote.read_cost 权限 */
  costPrice?: number;
  /** 敏感：需 quote.read_margin 权限 */
  marginAmount?: number;
  taxRate?: number;
  deliveryTerms?: string;
}

// ===== 共享镜像（10.23）=====
export interface ShareProjection {
  id: string;
  sourceWorkspaceId: string;
  sourceObjectType: 'GOODS' | 'DEMAND' | 'CONTACT';
  sourceObjectId: string;
  targetWorkspaceId: string;
  projectionObjectId?: string;
  /** 共享字段白名单；默认不含货主/上游/成本价/佣金/聊天原文/完整SN（17.1） */
  fieldPolicy: { allowedFields: string[] };
  syncPolicy: SyncPolicy;
  status: ShareStatus;
  lastSyncedAt?: string;
  createdBy: string;
  createdAt: string;
}

// ===== 任务（10.24）=====
export interface WorkTask extends BaseEntity {
  relatedType?: 'GOODS' | 'DEMAND' | 'DEAL' | 'QUOTE';
  relatedId?: string;
  title: string;
  description?: string;
  assigneeUserId?: string;
  dueAt?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: TaskStatus;
  source: 'MANUAL' | 'SYSTEM' | 'AI';
  completedAt?: string;
}

// ===== 统一 API 响应（第 18 章）=====
export interface ApiResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: { code: string; message: string };
  requestId: string;
}
