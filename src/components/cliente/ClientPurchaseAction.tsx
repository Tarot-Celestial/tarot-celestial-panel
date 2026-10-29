"use client";

import { isValidElement, type ReactNode } from "react";
import ManualPurchaseButton from "./ManualPurchaseButton";

function getButtonLabel(children: ReactNode): ReactNode {
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return children.props.children || "Comprar ahora";
  }
  return children || "Comprar ahora";
}

export default function ClientPurchaseAction({ children, className, checkoutEnabled = false }: { children: ReactNode; className?: string; checkoutEnabled?: boolean }) {
  // Only callers using the verified customer checkout opt in. Other purchase
  // actions keep the telephone flow until they have a payment route.
  if (checkoutEnabled && isValidElement(children) && children.type === "button") return children;
  const disabled = isValidElement<{ disabled?: boolean }>(children) && children.props.disabled === true;
  return <ManualPurchaseButton className={className} disabled={disabled}>{getButtonLabel(children)}</ManualPurchaseButton>;
}
