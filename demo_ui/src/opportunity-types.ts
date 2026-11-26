import type { QuoteTerms } from "./circle-types";

export const opportunityStages = {
  NEW: "待跟进", FOLLOWING: "跟进中", QUOTED: "已报价", WON: "成交", LOST: "未成交",
} as const;
export const nextActions = {
  CONTACT: "联系客户", CUSTOMER_REPLY: "等客户回复", VERIFY_SUPPLY: "核实货源",
  SEND_QUOTE: "发报价", OTHER: "其他",
} as const;
export const tradeModes = { SPOT: "现货", FUTURES: "期货", RENTAL: "租赁" } as const;
export type OpportunityStage = keyof typeof opportunityStages;
export type NextAction = keyof typeof nextActions;
export type TradeMode = keyof typeof tradeModes;
export type OpportunityFields = {
  assigneeId: string;
  stage: OpportunityStage;
  nextAction: NextAction;
  nextStep: string;
  dueAt: string | null;
};
export type OpportunityDemand = {
  title: string; model: string; customer: string; quantity: number; unit: string; city: string; mode: TradeMode;
};
export type OpportunityQuoteRef = { threadId: string; messageId: number };
export type OpportunityQuote = {
  id: number; threadId: string; version: number; sentAt: string; outgoing: boolean; terms: QuoteTerms;
};
export type OpportunitySourceRef = { ownerId: string; id: string };
export type OpportunitySupply = OpportunitySourceRef & {
  title: string; model: string; source: string; city: string; mode: TradeMode; unit: string;
  quantity: number; plannedQuantity: number | null; verifiedQuantity: number; pressure: boolean; unavailable: boolean;
};
export type OpportunityEvent = {
  at: string; by: string; note: string; fields: OpportunityFields;
};
export type Opportunity = OpportunityFields & {
  id: string; version: number; demand: OpportunityDemand; demandRef: OpportunitySourceRef | null;
  createdAt: string; updatedAt: string; supplies: OpportunitySupply[];
  quotes: OpportunityQuote[]; events: OpportunityEvent[]; confirmedQuantity: number;
};
export type PortfolioLine = {
  key: string; model: string; mode: TradeMode; unit: string;
  demand: number; verified: number; unverified: number;
  sources: Array<OpportunitySourceRef & {
    title: string; source: string; city: string; quantity: number; date: string; kind: "DEMAND" | "VERIFIED" | "UNVERIFIED";
  }>;
};
export type OpportunityBoard = {
  manager: boolean; members: { id: string; name: string; active: boolean }[];
  opportunities: Opportunity[]; portfolio: PortfolioLine[];
};
export type OpportunitySeed = {
  demand: OpportunityDemand;
  demandId?: string;
  supplyId?: string;
  quote?: OpportunityQuoteRef;
  outgoingQuote?: boolean;
};
export const isOpenOpportunity = (stage: OpportunityStage) => stage !== "WON" && stage !== "LOST";
