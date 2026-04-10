type Props = {
  title: string;
  value: string;
  hint?: string;
  accent?: string;
  active?: boolean;
  onClick?: () => void;
};

export default function KpiCard({
  title,
  value,
  hint,
  accent = "#999",
  active = false,
  onClick
}: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? accent : "rgba(255,255,255,0.08)"}`,
        cursor: onClick ? "pointer" : "default",
        transition: "0.2s",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>

      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
        {value}
      </div>

      {hint && (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
