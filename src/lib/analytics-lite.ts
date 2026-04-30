export function getAnalytics({ leads, outboundItems, chatItems }: any) {
  const leadRows = Array.isArray(leads) ? leads : [];
  const callRows = Array.isArray(outboundItems) ? outboundItems : [];
  const chatRows = Array.isArray(chatItems) ? chatItems : [];

  const revenue = leadRows.reduce((acc: number, lead: any) => {
    const value = Number(lead?.cliente_revenue_total || lead?.cliente_revenue_30d || lead?.valor_total || lead?.importe_total || 0);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);

  const convertedLeads = leadRows.filter((lead: any) => {
    return Boolean(
      lead?.converted_first_payment ||
        Number(lead?.cliente_completed_payments_count || 0) > 0 ||
        Number(lead?.cliente_revenue_total || 0) > 0
    );
  }).length;

  const leadsCount = leadRows.length || 0;

  return {
  leads: leadsCount,
  calls: callRows.length || 0,
  chats: chatRows.length || 0,
  revenue,
  convertedLeads,
};
}
