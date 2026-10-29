"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import StaffDirectChatPanel from "@/components/chat/StaffDirectChatPanel";
import { useStaffChat } from "@/providers/StaffChatProvider";
import styles from "@/components/chat/StaffDirectChatPanel.module.css";

type Props = { open: boolean; onClose: () => void; onUnreadChange?: (count: number) => void };

export default function DockChatWidget({ open, onClose, onUnreadChange }: Props) {
  const { unreadTotal } = useStaffChat();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { onUnreadChange?.(unreadTotal); }, [unreadTotal, onUnreadChange]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  if (!open) return null;
  return <aside className={styles.dock} aria-label="Chat interno" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className={styles.dockBar}><span>Chat interno</span><button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar chat" title="Cerrar chat"><X size={18}/></button></div>
    <StaffDirectChatPanel compact/>
  </aside>;
}
