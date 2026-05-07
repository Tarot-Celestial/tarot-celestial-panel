"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Sparkles, Moon, Sun, Stars, Heart, Briefcase, Download, ShieldCheck, Mail, Clock, MapPin, UserRound } from "lucide-react";

type CartaResponse = {
  ok?: boolean;
  error?: string;
  carta?: {
    titulo: string;
    subtitulo: string;
    resumen: string;
    ficha: Record<string, string | number>;
    secciones: { titulo: string; texto: string }[];
    afirmaciones: string[];
    disclaimer: string;
  };
};

const campos = [
  { name: "nombre", label: "Nombre completo", type: "text", icon: UserRound, placeholder: "Ej. Laura Martínez" },
  { name: "email", label: "Email de entrega", type: "email", icon: Mail, placeholder: "tu@email.com" },
  { name: "fecha", label: "Fecha de nacimiento", type: "date", icon: Sun, placeholder: "" },
  { name: "hora", label: "Hora de nacimiento", type: "time", icon: Clock, placeholder: "" },
  { name: "ciudad", label: "Ciudad y país de nacimiento", type: "text", icon: MapPin, placeholder: "Ej. Madrid, España" },
];

const beneficios = [
  "Lectura híbrida: astrología simbólica + numerología + interpretación espiritual",
  "Diseño premium listo para guardar o imprimir como PDF",
  "Secciones de amor, misión, dinero, energía emocional y ritual personalizado",
  "Preparado para conectar Stripe, email automático y CRM cuando quieras activarlo",
];

export default function CartaAstralPage() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<CartaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const hasResult = Boolean(resultado?.ok && resultado.carta);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResultado(null);

    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const res = await fetch("/api/carta-astral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as CartaResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo generar la carta");
      setResultado(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch (err: any) {
      setError(err?.message || "Error generando la carta astral");
    } finally {
      setLoading(false);
    }
  }

  const today = useMemo(() => new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }), []);

  return (
    <main className="min-h-screen overflow-hidden bg-[#070514] text-white">
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          #carta-pdf, #carta-pdf * { visibility: visible !important; }
          #carta-pdf { position: absolute; inset: 0; width: 100%; background: white !important; color: #1d1238 !important; padding: 24px !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <section className="relative px-5 py-10 sm:px-8 lg:px-12">
        <div className="absolute left-[-10%] top-[-10%] h-72 w-72 rounded-full bg-purple-700/30 blur-3xl" />
        <div className="absolute right-[-10%] top-20 h-96 w-96 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div className="relative z-10 py-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-white/10 px-4 py-2 text-sm text-amber-100 shadow-2xl backdrop-blur">
              <Sparkles size={16} /> Carta astral premium automatizada
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-tight tracking-tight sm:text-6xl lg:text-7xl">
              Una carta astral bonita, profunda y lista para vender.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-purple-100/85">
              Página pública con formulario, lectura híbrida, presentación premium y resultado preparado para guardarse como PDF. Ideal para vender cartas astrales automáticas y conectar después con pagos, CRM y email.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {beneficios.map((b) => (
                <div key={b} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm leading-6 text-purple-50 shadow-xl backdrop-blur">
                  <ShieldCheck className="mb-2 text-amber-200" size={20} />
                  {b}
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 rounded-[2rem] border border-white/10 bg-white/[0.07] p-5 shadow-2xl backdrop-blur-xl sm:p-7">
            <div className="mb-6 rounded-3xl bg-gradient-to-br from-purple-950 via-[#17102d] to-[#080614] p-6 shadow-inner">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-amber-200/80">Tarot Celestial</p>
                  <h2 className="mt-2 text-3xl font-black">Solicita tu carta</h2>
                </div>
                <div className="grid h-16 w-16 place-items-center rounded-full bg-amber-200 text-purple-950 shadow-lg shadow-amber-300/20">
                  <Moon size={30} />
                </div>
              </div>
            </div>

            <form onSubmit={submit} className="grid gap-4">
              {campos.map((campo) => {
                const Icon = campo.icon;
                return (
                  <label key={campo.name} className="block">
                    <span className="mb-2 block text-sm font-semibold text-purple-100">{campo.label}</span>
                    <span className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0c0920] px-4 py-3 focus-within:border-amber-200/70">
                      <Icon size={18} className="text-amber-200" />
                      <input name={campo.name} type={campo.type} required placeholder={campo.placeholder} className="w-full bg-transparent text-white outline-none placeholder:text-purple-200/40" />
                    </span>
                  </label>
                );
              })}

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-purple-100">Tema principal de la lectura</span>
                <select name="objetivo" className="w-full rounded-2xl border border-white/10 bg-[#0c0920] px-4 py-4 text-white outline-none focus:border-amber-200/70">
                  <option value="amor, vínculos y claridad emocional">Amor y vínculos</option>
                  <option value="propósito, trabajo y abundancia">Trabajo, dinero y propósito</option>
                  <option value="sanación personal y etapa espiritual">Sanación y etapa espiritual</option>
                  <option value="lectura general de vida">Lectura general</option>
                </select>
              </label>

              {error && <div className="rounded-2xl border border-red-300/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}

              <button disabled={loading} className="mt-2 rounded-2xl bg-gradient-to-r from-amber-200 via-yellow-300 to-purple-300 px-6 py-4 text-lg font-black text-purple-950 shadow-2xl shadow-purple-900/40 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? "Canalizando tu carta..." : "Generar carta astral premium"}
              </button>
              <p className="text-center text-xs text-purple-200/70">Generación demo incluida. Lista para conectar pago antes de generar.</p>
            </form>
          </div>
        </div>
      </section>

      {hasResult && resultado?.carta && (
        <section ref={resultRef} className="px-5 pb-16 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-6xl">
            <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-3xl font-black">Resultado premium</h2>
              <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-bold text-purple-950 shadow-xl">
                <Download size={18} /> Guardar como PDF
              </button>
            </div>

            <article id="carta-pdf" className="overflow-hidden rounded-[2rem] border border-amber-200/20 bg-[#fbf6ea] text-[#23133f] shadow-2xl">
              <div className="relative bg-gradient-to-br from-[#261246] via-[#4b1b68] to-[#11091e] p-8 text-white sm:p-12">
                <div className="absolute right-8 top-8 opacity-20"><Stars size={120} /></div>
                <p className="text-sm uppercase tracking-[0.4em] text-amber-200">Carta Astral Premium</p>
                <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">{resultado.carta.titulo}</h1>
                <p className="mt-4 text-xl text-purple-100">{resultado.carta.subtitulo}</p>
                <p className="mt-8 max-w-3xl text-lg leading-8 text-white/85">{resultado.carta.resumen}</p>
                <p className="mt-8 text-sm text-amber-100">Generada el {today}</p>
              </div>

              <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[.8fr_1.2fr]">
                <aside className="rounded-3xl bg-white p-6 shadow-xl">
                  <h3 className="mb-5 flex items-center gap-2 text-2xl font-black"><Sun className="text-amber-500" /> Ficha energética</h3>
                  <div className="grid gap-3 text-sm">
                    {Object.entries(resultado.carta.ficha).map(([k, v]) => (
                      <div key={k} className="rounded-2xl bg-[#f5ecff] p-3">
                        <div className="text-xs uppercase tracking-widest text-purple-500">{labelFicha(k)}</div>
                        <div className="mt-1 font-bold">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                </aside>

                <div className="grid gap-5">
                  {resultado.carta.secciones.map((s, i) => (
                    <section key={s.titulo} className="rounded-3xl bg-white p-6 shadow-xl">
                      <div className="mb-3 flex items-center gap-3">
                        {iconFor(i)}
                        <h3 className="text-2xl font-black">{s.titulo}</h3>
                      </div>
                      <p className="text-base leading-8 text-[#3c2b57]">{s.texto}</p>
                    </section>
                  ))}
                </div>
              </div>

              <div className="border-t border-purple-100 bg-[#fffaf0] p-6 sm:p-10">
                <h3 className="text-2xl font-black">Afirmaciones personalizadas</h3>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {resultado.carta.afirmaciones.map((a) => (
                    <div key={a} className="rounded-3xl bg-white p-5 text-center font-bold shadow-lg">“{a}”</div>
                  ))}
                </div>
                <p className="mt-8 text-xs leading-6 text-purple-900/60">{resultado.carta.disclaimer}</p>
              </div>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}

function labelFicha(key: string) {
  const labels: Record<string, string> = {
    nombre: "Nombre",
    email: "Email",
    fecha: "Fecha",
    hora: "Hora",
    ciudad: "Ciudad",
    signoSolar: "Signo solar",
    elemento: "Elemento",
    ascendenteSimbolico: "Ascendente simbólico",
    numeroCaminoVida: "Camino de vida",
    paletaEnergetica: "Paleta energética",
  };
  return labels[key] || key;
}

function iconFor(index: number) {
  const icons = [Sun, Moon, Stars, Heart, Briefcase, Sparkles, ShieldCheck];
  const Icon = icons[index % icons.length];
  return <Icon className="text-purple-600" size={24} />;
}
