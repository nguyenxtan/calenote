import { Check } from "lucide-react";
import styles from "./OnboardingWizard.module.css";

interface ProgressRailProps {
  currentIndex: number;
  steps: readonly string[];
}

export function ProgressRail({ currentIndex, steps }: ProgressRailProps) {
  return (
    <nav className={styles.progress} aria-label="Tiến trình thiết lập">
      {steps.map((label, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;

        return (
          <div
            className={`${styles.progressItem} ${done ? styles.progressDone : ""} ${
              current ? styles.progressCurrent : ""
            }`}
            key={label}
            aria-current={current ? "step" : undefined}
          >
            <span className={styles.progressDot} aria-hidden="true">
              {done ? <Check size={13} strokeWidth={3} /> : index + 1}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </nav>
  );
}
