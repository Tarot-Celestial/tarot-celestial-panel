"use client";

import { UsersRound } from "lucide-react";
import styles from "./MyClientsPlaceholder.module.css";

export default function MyClientsPlaceholder() {
  return (
    <section className={styles.container} aria-labelledby="my-clients-title">
      <div className={styles.icon} aria-hidden="true">
        <UsersRound size={28} strokeWidth={1.8} />
      </div>
      <div className={styles.copy}>
        <h1 id="my-clients-title" className={styles.title}>Mis clientas</h1>
        <p className={styles.subtitle}>Gestiona y cuida tu cartera de clientas.</p>
      </div>
    </section>
  );
}
