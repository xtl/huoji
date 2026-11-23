export async function companyRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/enterprise" + path, {
    method,
    cache: "no-store",
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "请求未完成，请重试。");
  return data;
}
export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Staff = { userId: string; name: string; role: Role; active: number };
