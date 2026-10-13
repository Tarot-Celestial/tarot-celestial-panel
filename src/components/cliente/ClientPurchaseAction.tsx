"use client";

import { isValidElement, type ReactNode } from "react";
import ManualPurchaseButton from "./ManualPurchaseButton";

function getButtonLabel(children: ReactNode): ReactNode {
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return children.props.children || "Comprar ahora";
  }
  return children || "Comprar ahora";
}

export default function ClientPurchaseAction({ children, className }: { children: ReactNode; className?: string }) {
  const disabled = isValidElement<{ disabled?: boolean }>(children) && children.props.disabled === true;
  return <ManualPurchaseButton className={className} disabled={disabled}>{getButtonLabel(children)}</ManualPurchaseButton>;
}
