import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Pencil, UserRound } from "lucide-react";

interface Profile {
  displayName: string;
  avatar: string | null;
}

async function resizeAvatar(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片。");
    const size = Math.min(image.width, image.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", .85);
  } finally {
    image.close();
  }
}

async function requestProfile(token: string, signal: AbortSignal, patch?: Partial<Profile>): Promise<Profile> {
  const response = await fetch("/api/auth/profile", {
    method: patch ? "PATCH" : "GET",
    headers: { Authorization: "Bearer " + token, ...(patch ? { "Content-Type": "application/json" } : {}) },
    body: patch ? JSON.stringify(patch) : undefined,
    signal,
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result.displayName !== "string") {
    throw new Error(result?.error || "个人资料暂时无法访问，请稍后重试。");
  }
  return result;
}

function ProfileAvatar({ avatar }: { avatar: string | null }) {
  return <span className="account-avatar" aria-hidden="true">
    {avatar ? <img src={avatar} alt="" /> : <UserRound size={24} />}
  </span>;
}

export default function AccountProfile({ token, maskedPhone, onSaved }: {
  token: string;
  maskedPhone: string;
  onSaved: (displayName: string) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<"image" | "save" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveRequest = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void requestProfile(token, controller.signal)
      .then(result => { if (!controller.signal.aborted) setProfile(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); saveRequest.current?.abort(); };
  }, [token, reload]);

  async function selectAvatar(file: File) {
    setBusy("image");
    setError("");
    try {
      const avatar = await resizeAvatar(file);
      setDraft(current => current && { ...current, avatar });
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "Error" ? reason.message : "无法读取图片，请重新选择。");
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft || busy || saveRequest.current) return;
    const patch: Partial<Profile> = {};
    if (draft.displayName.trim() !== profile.displayName) patch.displayName = draft.displayName.trim();
    if (draft.avatar !== profile.avatar) patch.avatar = draft.avatar;
    if (!Object.keys(patch).length) { setDraft(null); return; }
    const controller = new AbortController();
    saveRequest.current = controller;
    setBusy("save");
    setError("");
    try {
      const updated = await requestProfile(token, controller.signal, patch);
      if (controller.signal.aborted) return;
      setProfile(updated);
      setDraft(null);
      setNotice("个人资料已保存。");
      onSaved(updated.displayName);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "个人资料保存失败。");
    } finally {
      saveRequest.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return <section className="account-surface account-padding account-personal-profile" aria-labelledby="account-personal-profile-heading">
    <h3 id="account-personal-profile-heading" className="account-heading">个人资料</h3>
    {draft ? <form className="account-profile-editor" onSubmit={save}>
      <div className="account-profile-photo">
        <ProfileAvatar avatar={draft.avatar} />
        <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void selectAvatar(file);
        }} />
        <button type="button" className="account-action-link" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
          <Camera size={16} />{busy === "image" ? "处理图片中…" : "更换头像"}
        </button>
        {draft.avatar && <button type="button" className="account-action-link" disabled={Boolean(busy)}
          onClick={() => setDraft({ ...draft, avatar: null })}>移除头像</button>}
      </div>
      <label className="account-profile-name">
        昵称
        <input maxLength={24} value={draft.displayName} placeholder={maskedPhone} disabled={busy === "save"}
          onChange={event => setDraft({ ...draft, displayName: event.target.value })} />
        <small className="account-caption">最多 24 个字符。留空则使用 {maskedPhone}。</small>
      </label>
      <div className="account-profile-actions">
        <button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy === "save" ? "保存中…" : "保存资料"}</button>
        <button type="button" className="account-action-link" disabled={Boolean(busy)}
          onClick={() => { setDraft(null); setError(""); }}>取消</button>
      </div>
    </form> : <div className="account-personal-summary">
      <ProfileAvatar avatar={profile?.avatar ?? null} />
      <strong>{profile?.displayName ?? maskedPhone}</strong>
      {profile && <button type="button" className="account-action-link" onClick={() => { setNotice(""); setDraft(profile); }}>
        <Pencil size={15} />编辑资料
      </button>}
      {!profile && !loading && <button type="button" className="account-action-link" onClick={() => setReload(value => value + 1)}>重新读取</button>}
    </div>}
    {error && <p className="account-profile-error" role="alert">{error}</p>}
    {notice && <p className="account-caption" role="status">{notice}</p>}
  </section>;
}
