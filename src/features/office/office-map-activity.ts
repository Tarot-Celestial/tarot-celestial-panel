import { officeDepartments, type OfficeDepartmentId } from "./catalog";

export type OfficeMapStation = OfficeDepartmentId | "atlas";
export type OfficeMapHandoff = {
  id: string;
  taskId: string;
  taskTitle: string;
  from: OfficeMapStation;
  to: OfficeMapStation;
  what: string;
  at: string;
};
export type FloorPoint = { x: number; y: number };

// Feet and service aisles, in percentages of the 3:2 floor illustration.
const desks: Record<OfficeMapStation, readonly [number, number, number]> = {
  atlas: [15.8, 19, 24.1], inteligencia: [32.4, 19.4, 24.1],
  "legal-documentacion": [68, 19.4, 24.1], "creacion-contenido": [84, 19.4, 24.1],
  "compras-alianzas": [12.1, 38.3, 43.3], "producto-id": [38.7, 38.3, 43.3],
  marketing: [62, 38.3, 43.3], "servicios-seguimiento": [88.2, 38.3, 43.3],
  operaciones: [11.7, 56.9, 61.9], finanzas: [38.3, 56.9, 61.9],
  comercial: [62.1, 56.9, 61.9], "seguridad-accesos": [89.2, 56.9, 61.9],
  talento: [11.7, 76.5, 81.8], estrategia: [38.2, 76.5, 81.8],
  clientes: [62.2, 76.5, 81.8], "captacion-reservas": [90, 76.5, 81.8],
};
const departments = new Map<string, (typeof officeDepartments)[number]>(officeDepartments.map(area => [area.id, area]));

export function stationName(id: OfficeMapStation) { return departments.get(id)?.name || "Atlas"; }
export function stationColor(id: OfficeMapStation) { return departments.get(id)?.color || "#f1d597"; }
export function officeDesk(id: OfficeMapStation): FloorPoint { const [x, y] = desks[id]; return { x, y }; }
export function officeRoute(from: OfficeMapStation, to: OfficeMapStation): FloorPoint[] {
  if (from === to) return [officeDesk(from)];
  const [x1, y1, aisle1] = desks[from];
  const [x2, y2, aisle2] = desks[to];
  return [
    { x: x1, y: y1 }, { x: x1, y: aisle1 },
    ...(aisle1 === aisle2 ? [] : [{ x: 50, y: aisle1 }, { x: 50, y: aisle2 }]),
    { x: x2, y: aisle2 }, { x: x2, y: y2 },
  ];
}

export function mapHandoffs(records: readonly OfficeMapHandoff[]): OfficeMapHandoff[] {
  const seen = new Set<string>();
  return records.filter(record => {
    if (!record.id || !record.taskId || !record.what?.trim() || !record.taskTitle?.trim() || record.from === record.to ||
        !Object.hasOwn(desks, record.from) || !Object.hasOwn(desks, record.to) || !Number.isFinite(Date.parse(record.at)) || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function routeTiming(points: FloorPoint[]) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(points[i].x - points[i - 1].x, (points[i].y - points[i - 1].y) * 2 / 3);
    distances.push(distances[i - 1] + distance);
  }
  const total = distances[distances.length - 1];
  return {
    duration: Math.max(1000, Math.min(4600, total * 45)),
    frames: points.map((point, i) => ({ left: point.x + "%", top: point.y + "%", offset: total ? distances[i] / total : 0 })),
  };
}
