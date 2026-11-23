import { randomInt } from "node:crypto";
import { Api } from "tls-sig-api-v2";

export function tencentDelivery() {
  const appId = Number(process.env.TENCENT_IM_APP_ID);
  const key = process.env.TENCENT_IM_SECRET_KEY?.trim();
  const admin = process.env.TENCENT_IM_ADMIN?.trim();
  if (!appId || !key || !admin) return null;
  const signer = new Api(appId, key);
  const known = new Set<string>();
  let adminSignature = "",
    expires = 0;
  async function call(method: string, body: object) {
    if (Date.now() >= expires) {
      adminSignature = signer.genUserSig(admin, 3600);
      expires = Date.now() + 3500_000;
    }
    const url = new URL("https://console.tim.qq.com/v4/" + method);
    url.search = new URLSearchParams({
      sdkappid: String(appId),
      identifier: admin,
      usersig: adminSignature,
      random: String(randomInt(0x100000000)),
      contenttype: "json",
    }).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok || (await res.json()).ErrorCode !== 0) throw new Error("IM 推送暂未送达");
  }
  async function ensure(id: string) {
    if (known.has(id)) return;
    await call("im_open_login_svc/account_import", { UserID: id });
    known.add(id);
  }
  return {
    credentials(id: string) {
      return { appId, userId: id, userSig: signer.genUserSig(id, 3600) };
    },
    async deliver(sender: string, recipient: string, thread: string, id: number) {
      await Promise.all([ensure(sender), ensure(recipient)]);
      await call("openim/sendmsg", {
        From_Account: sender,
        To_Account: recipient,
        SyncOtherMachine: 1,
        MsgRandom: id % 0x100000000,
        MsgBody: [
          {
            MsgType: "TIMCustomElem",
            MsgContent: { Data: JSON.stringify({ business: "huoji", thread, id }), Desc: "新的业务消息" },
          },
        ],
      });
    },
  };
}
