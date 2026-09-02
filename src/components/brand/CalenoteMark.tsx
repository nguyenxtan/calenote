import { CalendarDays } from "lucide-react";
import styles from "./CalenoteMark.module.css";

interface CalenoteMarkProps {
  compact?: boolean;
  inverse?: boolean;
}

export function CalenoteMark({ compact = false, inverse = false }: CalenoteMarkProps) {
  return (
    <div className={`${styles.brand} ${inverse ? styles.inverse : ""}`}>
      <span className={styles.symbol} aria-hidden="true">
        <CalendarDays size={compact ? 18 : 21} strokeWidth={2.3} />
        <span />
      </span>
      <span className={compact ? styles.wordCompact : styles.word}>calenote</span>
    </div>
  );
}
