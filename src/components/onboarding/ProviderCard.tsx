import { Check, Send } from "lucide-react";
import type { BotProvider } from "@/modules/connections/contracts";
import styles from "./OnboardingWizard.module.css";

interface ProviderCardProps {
  provider: BotProvider;
  selected: boolean;
  onSelect: () => void;
}

const providerCopy = {
  zalo: {
    name: "Zalo Bot Platform",
    description: "Kết nối bot riêng trong ứng dụng Zalo.",
    badge: "Việt Nam",
  },
  telegram: {
    name: "Telegram Bot API",
    description: "Tạo bot riêng qua @BotFather.",
    badge: "BotFather",
  },
} as const;

export function ProviderCard({ provider, selected, onSelect }: ProviderCardProps) {
  const copy = providerCopy[provider];

  return (
    <label
      className={`${styles.providerCard} ${selected ? styles.providerSelected : ""}`}
    >
      <input
        type="radio"
        name="bot-provider"
        value={provider}
        checked={selected}
        onChange={onSelect}
        className={styles.choiceInput}
        aria-label={`${copy.name}. ${copy.description}`}
      />
      <span className={`${styles.providerLogo} ${styles[`${provider}Logo`]}`} aria-hidden="true">
        {provider === "zalo" ? "Z" : <Send size={22} fill="currentColor" />}
      </span>
      <span className={styles.providerBody}>
        <span className={styles.providerTitleRow}>
          <strong>{copy.name}</strong>
          <small>{copy.badge}</small>
        </span>
        <span>{copy.description}</span>
      </span>
      <span className={styles.providerCheck} aria-hidden="true">
        {selected && <Check size={15} strokeWidth={3} />}
      </span>
    </label>
  );
}
