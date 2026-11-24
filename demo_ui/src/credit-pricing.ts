export const creditsPerYuan = 200;
export const pointsPerCostYuan = 560;
export const pricingVersion = "credits-v2";
export const rechargePricingVersion = "credits-v3";
export const monthlyPrice = 28;
export const monthlyCredits = monthlyPrice * creditsPerYuan;
export const annualPrice = monthlyPrice * 12;
export const annualBonusCredits = monthlyCredits * 3;
export const annualMonthlyCredits = (annualPrice * creditsPerYuan + annualBonusCredits) / 12;
const packageTitles = ["轻量包", "常用包", "批量包"];

export function creditPackagesFor(enterprise: boolean) {
  const amounts = enterprise ? [1000, 3000, 10000] : [100, 300, 500];
  return amounts.map((yuan, index) => ({
    id: "credits_cny_" + yuan,
    title: packageTitles[index],
    yuan,
    price: "¥" + yuan.toLocaleString("zh-CN"),
    credits: yuan * creditsPerYuan,
  }));
}
