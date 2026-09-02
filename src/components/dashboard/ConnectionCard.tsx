import Link from "next/link";
import { AlertCircle, ArrowRight, Bot, Radio, Webhook } from "lucide-react";
import styles from "./DashboardShell.module.css";

export function ConnectionCard() {
  return (
    <section className={`${styles.panel} ${styles.connectionPanel}`} aria-labelledby="connection-title">
      <header className={styles.connectionHeader}>
        <span className={styles.connectionIcon} aria-hidden="true"><Bot size={20} /></span>
        <div>
          <p>Kênh chat</p>
          <h2 id="connection-title">Kết nối bot</h2>
        </div>
      </header>

      <div className={styles.connectionStatus}>
        <span className={styles.warningDot} aria-hidden="true" />
        <div>
          <strong>Chưa kết nối thật</strong>
          <span>Webhook chưa được đăng ký</span>
        </div>
      </div>

      <div className={styles.connectionSteps}>
        <div className={styles.connectionDone}>
          <span><Radio size={14} /></span>
          <p><strong>Token verification</strong><small>API v0.1 đã sẵn sàng</small></p>
        </div>
        <div>
          <span><Webhook size={14} /></span>
          <p><strong>Webhook + /connect</strong><small>Cần deploy production</small></p>
        </div>
      </div>

      <div className={styles.honestyNote}>
        <AlertCircle size={15} />
        Card này phản ánh capability thật của repo, không phải trạng thái giả lập.
      </div>

      <Link href="/" className={styles.connectionCta}>
        Xác minh một bot
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
