export type TCToastTone = "success" | "error" | "warning" | "info";

export function tcToast(args: {
  title: string;
  description?: string;
  tone?: TCToastTone;
  duration?: number;
}) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("tc-toast", {
      detail: {
        title: args.title,
        description: args.description || "",
        tone: args.tone || "info",
        duration: args.duration,
      },
    })
  );
}
