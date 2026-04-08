// MODIFIED: filtro por rango
import { useState } from "react";

export default function AdminClientesTab({   clientes,   oro,   plata,   bronce,   onReviewClient, }: any) {
  const [filtroRango, setFiltroRango] = useState<string | null>(null);

  const clientesFiltrados = filtroRango
    ? clientes.filter((c: any) => c.rango_actual === filtroRango)
    : clientes;

  return (
    <div>
      <div>
        <div onClick={() => setFiltroRango("oro")}>🥇 Oro: {oro}</div>
        <div onClick={() => setFiltroRango("plata")}>🥈 Plata: {plata}</div>
        <div onClick={() => setFiltroRango("bronce")}>🥉 Bronce: {bronce}</div>
      </div>

      {filtroRango && (
        <button onClick={() => setFiltroRango(null)}>Quitar filtro</button>
      )}

      {clientesFiltrados.map((c: any) => (
        <div key={c.id}>{c.nombre}</div>
      ))}
    </div>
  );
}
