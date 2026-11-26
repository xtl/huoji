import { useEffect, useState } from "react";

function metaContent(name: string): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
}

/** desktop/build.py marks the Windows assistant's index.html with its edition. The website has no mark. */
export function assistantEdition(): "cloud" | "local-test" | null {
  const edition = metaContent("huoji-edition");
  return edition === "cloud" || edition === "local-test" ? edition : null;
}

let cloudHost: Promise<string> | undefined;

// The cloud assistant's local gateway reports the HTTPS service it forwards accounts and messages to.
function readCloudHost(): Promise<string> {
  if (!cloudHost) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    cloudHost = fetch("/api/local-cloud", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => typeof data?.origin === "string" ? new URL(data.origin).host : "")
      .catch(() => {
        cloudHost = undefined;
        return "";
      })
      .finally(() => clearTimeout(timeout));
  }
  return cloudHost;
}

export default function EditionBadge() {
  const edition = assistantEdition();
  const version = metaContent("huoji-version");
  const [host, setHost] = useState<string | null>(edition === "cloud" ? null : "");

  useEffect(() => {
    if (edition !== "cloud") return;
    let active = true;
    void readCloudHost().then(value => { if (active) setHost(value); });
    return () => { active = false; };
  }, [edition]);

  if (!edition || host === null) return null;
  const name = edition === "cloud" ? "云同步" : "本机测试";
  return <span className="edition-badge" data-edition={edition} title={[name, host, version].filter(Boolean).join(" · ")}>
    {name}
    {host && <span className="edition-host"> · {host}</span>}
    {version && ` · ${version}`}
  </span>;
}
