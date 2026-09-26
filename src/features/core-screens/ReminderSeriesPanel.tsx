"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SeriesResponseSchema, SeriesDecisionResponseSchema, type PublicSeriesView, type SeriesDecisionRequest } from "@/contracts/api/reminder-series";
import { apiRequest } from "@/lib/client-api";
import { ReminderSeriesCard } from "./ReminderSeriesCard";
import styles from "./ReminderSeriesCard.module.css";
export function ReminderSeriesPanel({ onUnauthorized, onChanged }: { onUnauthorized: () => void; onChanged: () => void }) {
  const [series, setSeries] = useState<PublicSeriesView[] | null>(null);
  const [error, setError] = useState(false); const current = useRef(0); const alive = useRef(false);
  const fetchRows = useCallback(async () => {
    const data = await apiRequest<unknown>("/api/reminder-series", { authenticated: true, onUnauthorized });
    return SeriesResponseSchema.parse({ data }).data.series;
  }, [onUnauthorized]);
  const load = async () => {
    const revision = ++current.current;
    try {
      const next = await fetchRows();
      if (alive.current && current.current === revision) { setSeries(next); setError(false); }
    } catch { if (alive.current && current.current === revision) setError(true); }
  };
  useEffect(() => {
    alive.current = true; let subscribed = true; const revision = ++current.current;
    void fetchRows().then(next => { if (subscribed && current.current === revision) { setSeries(next); setError(false); } },
      () => { if (subscribed && current.current === revision) setError(true); });
    return () => { subscribed = false; alive.current = false; };
  }, [fetchRows]);
  const decide = async (decision: SeriesDecisionRequest) => {
    const data = await apiRequest<unknown>("/api/reminder-series", { method: "POST", body: decision, authenticated: true, onUnauthorized });
    const { result } = SeriesDecisionResponseSchema.parse({ data }).data;
    if (result === "STALE") throw new Error("Stale decision");
    await load();
    onChanged();
  };
  if (!error && series?.length === 0) return null;
  return <section className={styles.panel} aria-label="Chuỗi lời nhắc"><h2>Chuỗi lời nhắc</h2>
    <p>Tối đa 10 chuỗi gần nhất và 10 đề xuất đang chờ. Mỗi chuỗi hiển thị đầy đủ các lần nhắc.</p>
    {error ? <p role="alert">Chưa thể tải chuỗi nhắc. Không thay đổi dữ liệu.</p> : series === null ? <p role="status">Đang tải chuỗi nhắc…</p> : null}
    <button type="button" onClick={() => void load()}>Làm mới chuỗi nhắc</button>
    {series?.map(item => <ReminderSeriesCard key={`${item.publicId}:${item.revision}`} series={item} onDecision={decide} />)}
  </section>;
}
