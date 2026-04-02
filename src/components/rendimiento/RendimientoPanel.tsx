"use client";

import { useEffect, useState } from "react";

type Props = {
  mode?: "admin" | "central";
};

export default function RendimientoPanel({ mode = "admin" }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    try {
      setLoading(true);

      const res = await fetch(`/api/crm/rendimiento/listar?mode=${mode}`);
      const json = await res.json();

      console.log("📊 DATA RENDIMIENTO:", json);

      if (json?.ok) {
        setData(json.data || []);
      } else {
        console.error("❌ ERROR LISTADO:", json);
      }
    } catch (err) {
      console.error("🔥 FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();

    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [mode]);

  if (loading) {
    return <div className="p-4">Cargando rendimiento...</div>;
  }

  if (!data.length) {
    return <div className="p-4">No hay registros aún</div>;
  }

  return (
    <div className="p-4 overflow-auto">
      <div className="mb-2 text-xs text-gray-500">
        Vista: {mode === "central" ? "Central" : "Admin"}
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th>Fecha</th>
            <th>ID</th>
            <th>Cliente</th>
            <th>Telefonista</th>
            <th>Tarotista</th>
            <th>Tiempo</th>
            <th>Código</th>
            <th>Pago</th>
            <th>Importe</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-t">
              <td>{row.fecha}</td>
              <td>{row.id_unico}</td>
              <td>{row.cliente_nombre}</td>
              <td>{row.telefonista_nombre}</td>
              <td>{row.tarotista_nombre || row.tarotista_manual_call}</td>
              <td>{row.tiempo}</td>
              <td>{row.resumen_codigo}</td>
              <td>{row.forma_pago || "-"}</td>
              <td>{row.importe ? `${row.importe}€` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
