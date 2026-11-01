import CentralWorkspace from "@/features/central/CentralWorkspace";

export const dynamic = "force-dynamic";

export default function Page() {
  return <CentralWorkspace expectedRole="central" />;
}
