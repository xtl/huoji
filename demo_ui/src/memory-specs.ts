// Traders often write capacity and transfer rate without a separator ("64g6400").
const commonRates = "1600|1866|2133|2400|2666|2933|3200|3600|4000|4400|4800|5200|5600|6000|6400|6800|7200|7600|8000|8800|9600";
const rateEnd = "(?![0-9]|\\s*(?:条|根|片|张|块|套|台|件|元|年))";
const compactSpec = new RegExp(`(?<!\\d)(\\d{1,4})\\s*GB?\\s*[-/]?\\s*(${commonRates})${rateEnd}`, "i");
const separateRate = new RegExp(`(?<![A-Z0-9])(${commonRates})${rateEnd}`, "i");

export function readCompactMemorySpec(text: string) {
  const match = compactSpec.exec(text);
  return match ? { capacity: `${match[1]}G`, frequency: match[2] } : null;
}

export function readMemoryFrequency(text: string): string {
  return readCompactMemorySpec(text)?.frequency ??
    text.match(/(?:频率\s*[:：]?\s*|DDR[345]\s*[-/]?\s*)(\d{4,5})(?!\d)/i)?.[1] ??
    text.match(/(?<!\d)(\d{4,5})\s*(?:MHz|MT\/s)/i)?.[1] ??
    separateRate.exec(text)?.[1] ?? "";
}
