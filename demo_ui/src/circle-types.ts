export type ListingKind = "供应" | "求购";
export type CircleParticipation = "allowed" | "locked" | "loading" | "unavailable";
export const businessRoles = ["货主", "贸易商", "数据中心", "租赁方", "技术服务方"] as const;
export function listingKindLabel(kind: string, mode?: string) {
  return mode === "租赁" ? (kind === "供应" ? "出租" : "求租") : kind;
}
export function sourceRoleLabel(role: string, mode: string) {
  return mode === "租赁" ? role.replace("采购", "求租").replace("受托供货", "受托出租") : role;
}
export interface ListingDraft {
  kind: ListingKind;
  title: string;
  quantity: string;
  city: string;
  mode: string;
  role: string;
  businessRole?: string;
  price: string;
  terms: string;
  days: number;
}
export interface CirclePost extends Omit<ListingDraft, "days"> {
  id: string;
  owner: string;
  author: string;
  companyName?: string;
  publishedAt: string;
  expiresAt: string;
  confirmedAt: string;
  closed: number;
  active: boolean;
}
export interface QuoteTerms {
  product?: string;
  quantity: string;
  price: string;
  tax: string;
  delivery: string;
  validUntil: string;
}
export interface CircleMessage {
  id: number;
  sender: string;
  text: string;
  kind: "text" | "quote" | "status";
  quote: QuoteTerms | null;
  version: number;
  sentAt: string;
}
export interface CircleThread {
  id: string;
  postId: string;
  peer: string;
  name: string;
  title: string;
  kind: string;
  status: "open" | "done";
  lastText: string;
  updatedAt: string;
  unread: number;
}
export interface CircleQuestion {
  id: number;
  author: string;
  body: string;
  answer: string;
  createdAt: string;
}
export interface CircleSource {
  id: string;
  kind: ListingKind;
  title: string;
  model: string;
  quantity: string;
  city: string;
  mode: string;
}

export function matchingCircleSources(post: CirclePost, sources: CircleSource[]) {
  const title = post.title.toUpperCase();
  return sources.filter((s) => {
    if (s.kind === post.kind || (s.mode === "租赁") !== (post.mode === "租赁")) return false;
    const parts = (s.model || "").toUpperCase().match(/[A-Z0-9\u4e00-\u9fff]+/g) ?? [];
    const model = parts.join("");
    if (model.length < 3 || model.length > 90 || !/[0-9]/.test(model)) return false;
    // Match complete model codes. H20 and H200 represent different products.
    const pattern = "(?:^|[^A-Z0-9])" + parts.join("[\\s/_-]*") + "(?=$|[^A-Z0-9])";
    return new RegExp(pattern).test(title);
  });
}
