import { updateReserva } from "@/lib/server/reservas-update";
export const runtime = "nodejs";
export async function POST(req: Request) { return updateReserva(req); }
