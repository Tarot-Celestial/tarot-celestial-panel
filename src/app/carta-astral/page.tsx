"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import {
  Sparkles,
  Moon,
  Sun,
  Heart,
  Gem,
  ShieldCheck,
  Mail,
  Download,
  Clock,
  MapPin,
  Star,
  Wand2,
  CreditCard,
  Gift,
  ChevronRight,
} from "lucide-react";
import styles from "./CartaAstral.module.css";

type FormState = {
  nombre: string;
  email: string;
  telefono: string;
  fechaNacimiento: string;
  horaNacimiento: string;
  ciudadNacimiento: string;
  paisNacimiento: string;
  temaPrincipal: string;
  pregunta: string;
};

type Reading = {
  ok: boolean;
  resumen?: string;
  arquetipo?: string;
  puntos?: { titulo: string; valor: string; detalle: string }[];
  mensaje?: string;
  ritual?: string;
  error?: string;
};

const initialForm: FormState = {
  nombre: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  horaNacimiento: "",
  ciudadNacimiento: "",
  paisNacimiento: "España",
  temaPrincipal: "amor",
  pregunta: "",
};

const symbols = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

export default function CartaAstralPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canPreview = useMemo(() => {
    return form.nombre.trim() && form.email.trim() && form.fechaNacimiento && form.horaNacimiento && form.ciudadNacimiento.trim();
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function generatePreview(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setReading(null);

    if (!canPreview) {
      setMessage("Completa nombre, email, fecha, hora y ciudad para ver tu muestra gratuita.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/carta-astral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setReading(data);
      if (!data.ok) setMessage(data.error || "No se ha podido crear la muestra.");
    } catch {
      setMessage("No se ha podido conectar con el generador. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    setMessage(null);
    if (!canPreview) {
      setMessage("Antes de pagar, completa tus datos de nacimiento para preparar tu carta personalizada.");
      document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/carta-astral/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setMessage(data?.message || "Pedido preparado. Conecta Stripe para activar el pago automático.");
      document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" });
    } catch {
      setMessage("No se pudo iniciar el pago. Revisa la configuración de Stripe.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  function printSample() {
    window.print();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.nav}>
          <div className={styles.brand}><span className={styles.logoOrb} /> Tarot Celestial</div>
          <div className={styles.navLinks}>
            <a href="#incluye">Qué incluye</a>
            <a href="#muestra">Ejemplo</a>
            <a href="#pedido">Crear carta</a>
            <button className={styles.navCta} onClick={startCheckout}>Quiero mi carta</button>
          </div>
        </nav>

        <section className={styles.hero}>
          <div>
            <div className={styles.kicker}><Sparkles size={16} /> Carta astral personalizada · lectura híbrida premium</div>
            <h1 className={styles.h1}><span>Descubre el mapa</span><span>secreto de tu alma</span></h1>
            <p className={styles.lead}>
              Una carta astral visual, profunda y fácil de entender: combinamos cálculo astrológico simbólico con una interpretación espiritual escrita para ti, con tu fecha, hora y lugar de nacimiento.
            </p>
            <div className={styles.heroActions}>
              <button className={styles.primary} onClick={startCheckout}><CreditCard size={19} /> Obtener mi carta completa <ChevronRight size={18} /></button>
              <a className={styles.secondary} href="#muestra"><Gift size={18} /> Ver ejemplo gratis</a>
            </div>
            <div className={styles.trust}>
              <div className={styles.trustItem}><strong>PDF premium</strong>Diseñado para guardar, imprimir o regalar.</div>
              <div className={styles.trustItem}><strong>Entrega digital</strong>Preparada para email automático tras pago.</div>
              <div className={styles.trustItem}><strong>Lectura humana</strong>Clara, emocional y sin tecnicismos fríos.</div>
            </div>
          </div>

          <div className={styles.heroCard}>
            <div className={styles.zodiac}>
              <div className={styles.wheel}>
                {symbols.map((s, i) => <span className={styles.symbol} style={{ "--a": `${i * 30}deg` } as any} key={s}>{s}</span>)}
              </div>
              <div className={styles.moon}>☾</div>
              <div className={styles.cardCaption}>
                <b>Tu carta no es una predicción genérica.</b><br />Es una lectura de tus ciclos, dones, bloqueos y dirección emocional según tu cielo natal.
              </div>
            </div>
          </div>
        </section>

        <section id="incluye" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.eyebrow}>lo que recibirá el cliente</div>
            <h2 className={styles.h2}>Una experiencia astral preparada para vender</h2>
            <p className={styles.sub}>No solo una página de texto: una lectura guiada, bonita, emocional y con sensación de producto premium.</p>
          </div>
          <div className={styles.grid3}>
            <Feature icon={<Sun />} title="Identidad cósmica" text="Sol, Luna, Ascendente simbólico, energía dominante y forma de vivir tus emociones." />
            <Feature icon={<Heart />} title="Amor y vínculos" text="Cómo amas, qué necesitas para sentirte segura/o y qué patrones conviene sanar." />
            <Feature icon={<Gem />} title="Vocación y dinero" text="Tus talentos naturales, bloqueos de abundancia y forma de tomar decisiones." />
            <Feature icon={<Moon />} title="Sombras y heridas" text="Lectura dulce pero honesta de miedos, autosabotajes y aprendizajes de alma." />
            <Feature icon={<Wand2 />} title="Ritual personalizado" text="Un pequeño ritual de intención según el tema elegido por el cliente." />
            <Feature icon={<Mail />} title="Captación CRM" text="Formulario preparado para capturar email, teléfono e interés principal." />
          </div>
        </section>

        <section id="muestra" className={styles.section}>
          <div className={styles.sample}>
            <div className={styles.samplePanel}>
              <div className={styles.eyebrow}>ejemplo de lo que verá</div>
              <h2 className={styles.h2}>Una muestra que despierta deseo de compra</h2>
              <p className={styles.sub}>
                El cliente ve una pequeña lectura gratuita. La carta completa queda como producto premium: más páginas, más secciones, PDF final y guía personalizada.
              </p>
              <ul>
                <li>Lenguaje emocional y cercano.</li>
                <li>Visual de carta astral para aumentar valor percibido.</li>
                <li>CTA claro después de la muestra.</li>
                <li>Preparado para Stripe con variables de entorno.</li>
              </ul>
            </div>
            <div className={styles.reportPage}>
              <div className={styles.reportTop}>
                <div>
                  <p className={styles.reportTitle}>Carta Astral de Luna</p>
                  <small>Madrid · 14:35 · Tema principal: amor</small>
                </div>
                <span className={styles.badge}>Muestra</span>
              </div>
              <div className={styles.miniGrid}>
                <div className={styles.mini}><b>☉ Sol simbólico</b>Tu esencia busca brillar sin pedir permiso.</div>
                <div className={styles.mini}><b>☾ Luna emocional</b>Necesitas seguridad antes de abrir el corazón.</div>
                <div className={styles.mini}><b>↟ Ascendente</b>Los demás perciben misterio, fuerza y sensibilidad.</div>
                <div className={styles.mini}><b>✦ Consejo</b>Tu próxima etapa pide elegir desde la calma, no desde el miedo.</div>
              </div>
              <div className={styles.quote}>
                “Tu cielo natal habla de una persona intensa, intuitiva y magnética. Cuando dejas de perseguir respuestas fuera, tu energía se ordena y empiezas a atraer relaciones más claras.”
              </div>
            </div>
          </div>
        </section>

        <section id="pedido" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.eyebrow}>crear carta personalizada</div>
            <h2 className={styles.h2}>Haz que el cliente sienta que ya está entrando en su universo</h2>
            <p className={styles.sub}>Este formulario sirve como captación y como base para generar la carta completa tras el pago.</p>
          </div>

          <div className={styles.formWrap}>
            <aside className={`${styles.card} ${styles.priceCard}`}>
              <div className={styles.kicker}><ShieldCheck size={15} /> Producto digital premium</div>
              <div className={styles.price}>29€ <small>/ carta</small></div>
              <p>Incluye PDF personalizado, lectura astral completa, ritual y guía de amor/vocación. Precio editable en Stripe.</p>
              <button className={`${styles.primary} ${checkoutLoading ? styles.loading : ""}`} onClick={startCheckout} disabled={checkoutLoading}>
                {checkoutLoading ? "Preparando pago..." : "Pagar y recibir mi carta"}
              </button>
              <p className={styles.help}>Para activar pago real: configura STRIPE_SECRET_KEY y STRIPE_CARTA_ASTRAL_PRICE_ID.</p>
            </aside>

            <div className={styles.card}>
              <form className={styles.form} onSubmit={generatePreview}>
                <Field label="Nombre" value={form.nombre} onChange={(v) => update("nombre", v)} placeholder="Ej. Laura" />
                <Field label="Email" type="email" value={form.email} onChange={(v) => update("email", v)} placeholder="tu@email.com" />
                <Field label="Teléfono / WhatsApp" value={form.telefono} onChange={(v) => update("telefono", v)} placeholder="Opcional" />
                <Field label="Fecha de nacimiento" type="date" value={form.fechaNacimiento} onChange={(v) => update("fechaNacimiento", v)} />
                <Field label="Hora exacta" type="time" value={form.horaNacimiento} onChange={(v) => update("horaNacimiento", v)} hint="La hora ayuda a personalizar el ascendente." />
                <Field label="Ciudad de nacimiento" value={form.ciudadNacimiento} onChange={(v) => update("ciudadNacimiento", v)} placeholder="Ej. Barcelona" />
                <div className={styles.field}>
                  <label className={styles.label}>Tema principal</label>
                  <select className={styles.select} value={form.temaPrincipal} onChange={(e) => update("temaPrincipal", e.target.value)}>
                    <option value="amor">Amor y relaciones</option>
                    <option value="dinero">Dinero y abundancia</option>
                    <option value="vocacion">Vocación y propósito</option>
                    <option value="sanacion">Sanación emocional</option>
                    <option value="general">Lectura general</option>
                  </select>
                </div>
                <Field label="País" value={form.paisNacimiento} onChange={(v) => update("paisNacimiento", v)} />
                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label}>Pregunta o situación actual</label>
                  <textarea className={styles.textarea} value={form.pregunta} onChange={(e) => update("pregunta", e.target.value)} placeholder="Ej. Quiero entender por qué repito el mismo patrón en el amor..." />
                </div>
                <div className={styles.fieldFull}>
                  <button className={`${styles.secondary} ${loading ? styles.loading : ""}`} type="submit" disabled={loading}>{loading ? "Leyendo tu cielo..." : "Generar muestra gratuita"}</button>
                  <button className={styles.ghostBtn} type="button" onClick={printSample}><Download size={16} /> Guardar vista como PDF</button>
                  {message && <div className={message.includes("preparado") ? styles.success : styles.error}>{message}</div>}
                </div>
              </form>

              {reading?.ok && (
                <div className={styles.result}>
                  <h3>✨ Muestra personalizada para {form.nombre}</h3>
                  <p className={styles.resultText}>{reading.resumen}</p>
                  <div className={styles.resultGrid}>
                    {(reading.puntos || []).map((p) => (
                      <div className={styles.resultChip} key={p.titulo}><b>{p.titulo}</b><br /><span>{p.valor}</span><p>{p.detalle}</p></div>
                    ))}
                  </div>
                  <p className={styles.resultText}><b>Mensaje canalizado:</b> {reading.mensaje}</p>
                  <p className={styles.resultText}><b>Ritual sugerido:</b> {reading.ritual}</p>
                  <button className={styles.primary} onClick={startCheckout}>Quiero la carta completa en PDF</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.eyebrow}>confianza</div>
            <h2 className={styles.h2}>Pensada para que el cliente compre sin sentirse presionado</h2>
          </div>
          <div className={styles.testimonials}>
            <Testimonial initials="M" text="La muestra me tocó justo donde estaba. Compré la carta completa porque sentí que hablaba de mí." />
            <Testimonial initials="A" text="Me encantó que no fuera fría ni técnica. Parecía una lectura hecha con mucho cuidado." />
            <Testimonial initials="S" text="El PDF es precioso para regalar. La parte de amor y patrones fue brutal." />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.faq}>
            <div className={styles.faqItem}><b>¿La carta se genera automáticamente?</b><p>Sí. La página ya está preparada para capturar datos, generar muestra y conectar el pago con Stripe. Después se puede ampliar para enviar PDF por email automáticamente.</p></div>
            <div className={styles.faqItem}><b>¿Qué pasa si no sé la hora exacta?</b><p>Puede recibir una lectura igualmente, pero se avisa de que el ascendente será aproximado.</p></div>
            <div className={styles.faqItem}><b>¿Se puede conectar al CRM?</b><p>Sí. Lo ideal es guardar el lead con etiqueta “Carta Astral” y después activar campañas o llamadas desde central.</p></div>
          </div>
        </section>

        <section className={styles.footerCta}>
          <div className={styles.eyebrow}>tarot celestial</div>
          <h2 className={styles.h2}>Tu cielo natal convertido en una experiencia de compra mágica</h2>
          <button className={styles.primary} onClick={() => document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" })}>Crear mi carta astral</button>
        </section>
      </div>
    </main>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className={styles.card}><div className={styles.icon}>{icon}</div><h3>{title}</h3><p>{text}</p></div>;
}

function Testimonial({ initials, text }: { initials: string; text: string }) {
  return <div className={styles.card}><div className={styles.avatar}>{initials}</div><p>“{text}”</p><div style={{ color: "#ffe2a1" }}><Star size={15} fill="currentColor" /> <Star size={15} fill="currentColor" /> <Star size={15} fill="currentColor" /> <Star size={15} fill="currentColor" /> <Star size={15} fill="currentColor" /></div></div>;
}

function Field({ label, value, onChange, type = "text", placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className={styles.input} value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} />
      {hint && <span className={styles.help}>{hint}</span>}
    </div>
  );
}
