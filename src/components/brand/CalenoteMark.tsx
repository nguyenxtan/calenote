import styles from "./CalenoteMark.module.css";

interface CalenoteMarkProps {
  compact?: boolean;
  inverse?: boolean;
}

export function CalenoteMark({ compact = false, inverse = false }: CalenoteMarkProps) {
  const source = compact
    ? inverse ? "/brand/calenote-mark-monochrome.svg" : "/brand/calenote-mark.svg"
    : inverse ? "/brand/calenote-logo-on-dark.svg" : "/brand/calenote-logo-horizontal.svg";

  return (
    <span className={`${styles.brand} ${compact ? styles.compact : ""}`}>
      <img alt="Calenote" src={source} />
    </span>
  );
}
