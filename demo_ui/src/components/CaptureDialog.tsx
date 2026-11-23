import React, { useId, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

export default function CaptureDialog({ title, open = true, onDismiss, children }: {
  title: string; open?: boolean; onDismiss: () => void; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    if (open) node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, [open]);

  return <dialog ref={dialog} className="capture-dialog" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }}>
    <header><h2 id={heading}>{title}</h2>
      <button type="button" onClick={onDismiss} className="capture-close" aria-label="关闭窗口"><X size={19} /></button>
    </header>
    <div className="capture-dialog-body">{children}</div>
  </dialog>;
}
