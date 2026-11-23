export function collectorConnection(options: {
  deviceId: string;
  apiBaseUrl: string;
  token: string;
  scope: { userId: string; workspaceId: string };
  groups: readonly string[];
  statePath?: string;
  pollIntervalSeconds?: number;
  batchSize?: number;
}) {
  const {
    deviceId,
    apiBaseUrl,
    token,
    scope,
    groups,
    statePath = `.data/wechat-rpa-${options.deviceId}.sqlite3`,
    pollIntervalSeconds = 10,
    batchSize = 50,
  } = options;
  return {
    schemaVersion: 1,
    deviceId,
    apiBaseUrl,
    token,
    scope,
    groups: [...groups],
    pollIntervalSeconds,
    statePath,
    upload: { enabled: true as const, batchSize },
    capture: { mode: "ocr", profiles: {} },
    selectors: {
      window: { controlType: "WindowControl", name: "{chatName}", maxDepth: 1 },
      title: { controlType: "TextControl", name: "{chatName}", maxDepth: 6 },
      messageList: { controlType: "ListControl", name: "消息", maxDepth: 8 },
      messageItem: { controlType: "ListItemControl", maxDepth: 1 },
      sender: { controlType: "TextControl", automationId: "REPLACE_WITH_INSPECTED_SENDER_ID", maxDepth: 4 },
      text: { controlType: "TextControl", automationId: "REPLACE_WITH_INSPECTED_MESSAGE_TEXT_ID", maxDepth: 4 },
    },
  };
}
