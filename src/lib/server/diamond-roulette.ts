export async function loadRouletteSummary(admin: any, clienteId: string) {
  const [base, diamond] = await Promise.all([
    admin.rpc("cliente_ruleta_resumen_ultra_v1", { p_cliente_id: clienteId }),
    admin.rpc("tc_diamond_roulette_summary_v1", { p_cliente_id: clienteId }),
  ]);
  if (base.error) throw base.error;
  if (diamond.error) throw diamond.error;
  const data = { ...base.data, ...diamond.data };
  data.catalogue = [...(base.data?.catalogue || []).filter((p: any) => Number(p.nivel) !== 5), ...(diamond.data?.catalogue || [])];
  data.available_spins = [1, 2, 3, 4, 5].reduce((sum, n) => sum + Number(data[`level_${n}_spins`] || 0), 0);
  data.next_level = [1, 2, 3, 4, 5].find(n => Number(data[`level_${n}_spins`] || 0) > 0) || 1;
  return data;
}
