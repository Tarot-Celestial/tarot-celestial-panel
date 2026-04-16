"use client";

import { useMemo } from "react";

type Props = {
  minutos: number; // minutos consumidos reales
};

type Rango = {
  nombre: string;
  min: number;
  max: number;
};

const RANGOS: Rango[] = [
  { nombre: "Bronce", min: 0, max: 100 },
  { nombre: "Plata", min: 100, max: 300 },
  { nombre: "Oro", min: 300, max: 600 },
  { nombre: "Diamante", min: 600, max: 999999 },
];

export default function ProgressRango({ minutos }: Props) {
  const { rangoActual, siguienteRango, progreso } = useMemo(() => {
    let actual = RANGOS[0];
    let siguiente = RANGOS[1];

    for (let i = 0; i < RANGOS.length; i++) {
      if (minutos >= RANGOS[i].min && minutos < RANGOS[i].max) {
        actual = RANGOS[i];
        siguiente = RANGOS[i + 1] || null;
        break;
      }
    }

    if (!siguiente) {
      return {
        rangoActual: actual,
        siguienteRango: null,
        progreso: 100,
      };
    }

    const progreso =
      ((minutos - actual.min) / (actual.max - actual.min)) * 100;

    return {
      rangoActual: actual,
      siguienteRango: siguiente,
      progreso: Math.max(0, Math.min(100, progreso)),
    };
  }, [minutos]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{rangoActual.nombre}</span>
        {siguienteRango && <span>{siguienteRango.nombre}</span>}
      </div>

      <div
        style={{
          height: 10,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progreso}%`,
            height: "100%",
            background: "linear-gradient(90deg, gold, orange)",
            transition: "width 0.5s ease",
          }}
        />
      </div>

      {siguienteRango && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Te faltan{" "}
          <b>{siguienteRango.min - minutos}</b> minutos para llegar a{" "}
          <b>{siguienteRango.nombre}</b>
        </div>
      )}
    </div>
  );
}
