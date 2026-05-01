export function getConversionProbability(lead: any) {
  let score = 0;

  const rank = String(
    lead?.rango_actual ||
    lead?.rango ||
    lead?.cliente?.rango ||
    ""
  ).toLowerCase();

  if (rank === "oro" || rank === "gold") score += 0.4;
  else if (rank === "plata" || rank === "silver") score += 0.25;
  else score += 0.1;

  const revenue = Number(lead?.cliente_revenue_total || 0);
  if (revenue > 200) score += 0.3;
  else if (revenue > 50) score += 0.2;
  else if (revenue > 0) score += 0.1;

  if (lead?.updated_at) {
    const minutes = (Date.now() - new Date(lead.updated_at).getTime()) / 60000;
    if (minutes < 60) score += 0.2;
    else if (minutes < 1440) score += 0.1;
  }

  const attempts = Number(lead?.attempts || 0);
  if (attempts > 5) score -= 0.15;
  else if (attempts > 2) score -= 0.05;

  return Math.max(0, Math.min(1, score));
}
