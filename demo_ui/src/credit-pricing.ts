export const creditsPerYuan = 200;
export const pointsPerCostYuan = 560;
export const pricingVersion = "credits-v2";
export const monthlyPrice = 28;
export const monthlyCredits = monthlyPrice * creditsPerYuan;
export const annualPrice = monthlyPrice * 12;
export const annualBonusCredits = monthlyCredits * 3;
export const annualMonthlyCredits = (annualPrice * creditsPerYuan + annualBonusCredits) / 12;
export const creditPackages = [
  { id: "credits_cny_10", title: "轻量包", yuan: 10 },
  { id: "credits_cny_50", title: "常用包", yuan: 50 },
  { id: "credits_cny_100", title: "批量包", yuan: 100 },
].map((pack) => ({ ...pack, price: "¥" + pack.yuan, credits: pack.yuan * creditsPerYuan }));
