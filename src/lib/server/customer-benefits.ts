import type { CustomerBenefitPolicy } from "@/lib/customer-benefits";

export async function customerBenefitPolicy(db: any): Promise<CustomerBenefitPolicy | null> {
  const { data, error } = await db.rpc("tc_customer_benefits_config");
  if (error && ["42883", "PGRST202"].includes(error.code)) return null;
  if (error) throw error;
  if (!data?.version || !data?.ranks) throw new Error("BENEFIT_POLICY_UNAVAILABLE");
  return data;
}
