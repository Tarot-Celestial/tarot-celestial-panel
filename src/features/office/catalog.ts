export const officeDepartments = [
  { id: 'comercial', name: 'Comercial', shortName: 'Comercial', initials: 'CO', color: '#6bded0', purpose: 'Organizar interesados, preparar propuestas con promociones vigentes y seguir las conversiones.' },
  { id: 'captacion-reservas', name: 'Captación y reservas', shortName: 'Captación', initials: 'CR', color: '#81c6ff', purpose: 'Consultar disponibilidad y coordinar las reservas y sus confirmaciones con las centrales.' },
  { id: 'marketing', name: 'Marketing', shortName: 'Marketing', initials: 'MK', color: '#f192cf', purpose: 'Planificar campañas por mercado, público y fecha, y coordinar las publicaciones de Instagram.' },
  { id: 'creacion-contenido', name: 'Creación de contenido', shortName: 'Contenido', initials: 'CC', color: '#c7a7ff', purpose: 'Preparar textos, imágenes, carruseles y guiones con la identidad de Tarot Celestial.' },
  { id: 'finanzas', name: 'Finanzas', shortName: 'Finanzas', initials: 'FI', color: '#eac989', purpose: 'Consultar Contabilidad para elaborar resúmenes de ingresos, gastos y márgenes.' },
  { id: 'servicios-seguimiento', name: 'Servicios y seguimiento', shortName: 'Servicios', initials: 'SS', color: '#75d3cf', purpose: 'Seguir reservas, servicios contratados y avances registrados en Mi Ritual.' },
  { id: 'operaciones', name: 'Operaciones', shortName: 'Operaciones', initials: 'OP', color: '#9fbbff', purpose: 'Revisar horarios, cobertura de tarotistas, disponibilidad e incidencias.' },
  { id: 'inteligencia', name: 'Inteligencia', shortName: 'Inteligencia', initials: 'IN', color: '#b1a4ff', purpose: 'Analizar datos disponibles y preparar informes con sus fuentes, períodos y fechas.' },
  { id: 'clientes', name: 'Clientes', shortName: 'Clientes', initials: 'CL', color: '#75d9a8', purpose: 'Atender preguntas y consultar información autorizada sobre rangos, ruleta, minutos y referidos.' },
  { id: 'producto-id', name: 'Producto e I+D', shortName: 'Producto e I+D', initials: 'ID', color: '#87cded', purpose: 'Organizar incidencias y propuestas y preparar especificaciones para mejorar el panel.' },
  { id: 'talento', name: 'Talento', shortName: 'Talento', initials: 'TA', color: '#f3b294', purpose: 'Preparar ofertas de empleo, organizar candidaturas y apoyar la formación del equipo.' },
  { id: 'legal-documentacion', name: 'Legal y documentación', shortName: 'Legal', initials: 'LD', color: '#e0c48b', purpose: 'Organizar condiciones, consentimientos y borradores para su revisión.' },
  { id: 'compras-alianzas', name: 'Compras y alianzas', shortName: 'Alianzas', initials: 'CA', color: '#8fd6b5', purpose: 'Comparar proveedores y preparar propuestas de colaboración con fuentes y condiciones.' },
  { id: 'estrategia', name: 'Estrategia', shortName: 'Estrategia', initials: 'ES', color: '#e4adf4', purpose: 'Reunir resultados y proponer prioridades, objetivos y acciones a Álex.' },
  { id: 'seguridad-accesos', name: 'Seguridad y accesos', shortName: 'Seguridad', initials: 'SA', color: '#9aaef4', purpose: 'Revisar permisos, conexiones e incidencias del sistema.' },
] as const;

export const OFFICE_DEPARTMENTS = officeDepartments;
export type OfficeDepartment = (typeof officeDepartments)[number];
export type OfficeDepartmentId = OfficeDepartment['id'];
