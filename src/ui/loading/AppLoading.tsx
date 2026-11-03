import { CalenoteMark } from "@/components/brand/CalenoteMark";
import styles from "./AppLoading.module.css";

/** Neutral placeholders only: the session has not authorized personal data yet. */
export function AppLoading() {
  return <main className={styles.page} aria-busy="true">
    <div className={styles.frame}>
      <div className={styles.header}>
        <CalenoteMark />
        <div className={styles.status} role="status" aria-label="Đang mở Calenote">
          <span className={styles.spinner} aria-hidden="true" />
          <div><p>Đang mở Calenote</p><span>Đang chuẩn bị không gian của bạn…</span></div>
        </div>
      </div>
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.sidebar}><i /><i /><i /><i /></div>
        <div className={styles.content}>
          <div className={styles.title}><i /><i /></div>
          <div className={styles.cards}><div><i /><i /><i /></div><div><i /><i /><i /></div></div>
          <div className={styles.rows}><i /><i /><i /></div>
        </div>
      </div>
    </div>
  </main>;
}
