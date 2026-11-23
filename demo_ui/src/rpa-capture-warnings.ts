export const ocrWarnings = {
  message: "昵称与消息气泡由截图位置配对，来源昵称、数量和价格仍需人工核对；原消息时间尚未识别。",
  unknownBubble: "这是一条完整文字消息，发送人昵称尚未识别；来源、单位和价格需要人工核对。",
  viewport: "截图文字可能混合多人和多个报价；来源、单位、价格归属需要逐条人工核对。",
} as const;

export const unknownSourceWarning = "部分条目没有识别到微信来源用户，请在待确认结果中补齐。";
