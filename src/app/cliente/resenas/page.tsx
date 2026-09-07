"use client";

import { useEffect, useState } from "react";
import { LockKeyhole, MessageCircle, Star } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./Reviews.module.css";

const sb = supabaseClienteBrowser();

type Review = { id: string; rating: number; comment: string; isMine: boolean };
type Central = {
  id: string;
  name: string;
  presentation: string;
  photoUrl: string | null;
  average: number;
  count: number;
  eligible: boolean;
  mine: Review | null;
  reviews: Review[];
};

export default function ReviewsPage() {
  const [items, setItems] = useState<Central[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { rating: number; comment: string }>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");
  const [loading, setLoading] = useState(true);

  async function token() {
    return (await sb.auth.getSession()).data.session?.access_token || "";
  }

  async function load() {
    setLoading(true);
    const accessToken = await token();
    if (!accessToken) {
      window.location.href = "/cliente/login";
      return;
    }
    const response = await fetch("/api/cliente/resenas", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (result.ok) {
      setItems(result.centrales || []);
      const nextDrafts: Record<string, { rating: number; comment: string }> = {};
      for (const central of result.centrales || []) {
        nextDrafts[central.id] = {
          rating: Number(central.mine?.rating || 0),
          comment: String(central.mine?.comment || ""),
        };
      }
      setDrafts(nextDrafts);
    } else {
      setMessage(result.error || "No se pudieron cargar los perfiles.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(central: Central) {
    const draft = drafts[central.id];
    if (!draft?.rating) {
      setMessage("Selecciona de 1 a 5 estrellas.");
      return;
    }
    setSaving(central.id);
    setMessage("");
    const accessToken = await token();
    const response = await fetch("/api/cliente/resenas", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: central.id, rating: draft.rating, comment: draft.comment }),
    });
    const result = await response.json();
    setSaving("");
    if (!result.ok) {
      setMessage(result.error || "No se pudo guardar la reseña.");
      return;
    }
    setMessage("Reseña guardada correctamente.");
    await load();
  }

  return (
    <ClienteLayout title="Reseñas" subtitle="Conoce a nuestras centrales y comparte tu experiencia real.">
      <section className={`tc-card ${styles.section}`}>
        <div className={styles.intro}>
          <div>
            <div className="tc-panel-title">Perfiles y reputación</div>
            <p className="tc-muted">Las estrellas proceden únicamente de clientas atendidas. Cada clienta mantiene una sola reseña editable por central.</p>
          </div>
          <div className={styles.realBadge}><Star size={15} /> Valoraciones verificadas</div>
        </div>

        {message ? <div className={styles.message}>{message}</div> : null}
        {loading ? <div className={styles.empty}>Cargando perfiles de las centrales…</div> : null}
        {!loading && !items.length ? <div className={styles.empty}>Todavía no hay centrales activas para mostrar.</div> : null}

        <div className={styles.grid}>
          {items.map((central) => {
            const draft = drafts[central.id] || { rating: 0, comment: "" };
            return (
              <article className={styles.card} key={central.id}>
                <div className={styles.profileTop}>
                  <div className={styles.avatar}>
                    {central.photoUrl ? <img src={central.photoUrl} alt={`Foto de ${central.name}`} /> : central.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className={styles.identity}>
                    <span className={styles.kicker}>CENTRAL TAROT CELESTIAL</span>
                    <h2>{central.name}</h2>
                    <div className={styles.publicRating} aria-label={`${central.average.toFixed(1)} de 5 estrellas`}>
                      <span>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={15} fill={value <= Math.round(central.average) ? "currentColor" : "none"} />)}</span>
                      <strong>{central.count ? `${central.average.toFixed(1)} · ${central.count} reseña${central.count === 1 ? "" : "s"}` : "Nueva · sin reseñas"}</strong>
                    </div>
                  </div>
                </div>

                <p className={styles.presentation}>{central.presentation}</p>

                {central.eligible ? (
                  <div className={styles.reviewForm}>
                    <div className={styles.formLabel}><MessageCircle size={15} /> Tu valoración</div>
                    <div className={styles.stars}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          type="button"
                          aria-label={`${value} estrellas`}
                          key={value}
                          className={value <= draft.rating ? styles.starOn : styles.star}
                          onClick={() => setDrafts((current) => ({ ...current, [central.id]: { ...draft, rating: value } }))}
                        >★</button>
                      ))}
                    </div>
                    <textarea
                      className={`tc-input tc-textarea ${styles.textarea}`}
                      maxLength={500}
                      value={draft.comment}
                      onChange={(event) => setDrafts((current) => ({ ...current, [central.id]: { ...draft, comment: event.target.value } }))}
                      placeholder={`¿Cómo fue tu experiencia con ${central.name}?`}
                    />
                    <button className="tc-btn tc-btn-gold" disabled={saving === central.id} onClick={() => save(central)}>
                      {saving === central.id ? "Guardando…" : central.mine ? "Actualizar reseña" : "Publicar reseña"}
                    </button>
                  </div>
                ) : (
                  <div className={styles.locked}><LockKeyhole size={16} /><span>Podrás valorar este perfil después de haber sido atendida por esta central.</span></div>
                )}

                <div className={styles.reviewList}>
                  {central.reviews.length ? central.reviews.slice(0, 3).map((review) => (
                    <div className={styles.review} key={review.id}>
                      <strong>{"★".repeat(review.rating)}{review.isMine ? " · Tu reseña" : ""}</strong>
                      {review.comment ? <p>{review.comment}</p> : null}
                    </div>
                  )) : <div className={styles.noReviews}>Todavía no hay opiniones publicadas.</div>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </ClienteLayout>
  );
}
