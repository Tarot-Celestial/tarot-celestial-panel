import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    total: 0,
    clientes: 0,
    reservas: 0,
    tarotistas: 0
  });
}
