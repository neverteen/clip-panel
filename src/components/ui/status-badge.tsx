const labels: Record<string, string> = {
  PENDING: "На проверке",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  PAID: "Оплачена",
};

const colors: Record<string, string> = {
  PENDING: "border-warning/30 bg-warning/10 text-warning",
  "На проверке": "border-warning/30 bg-warning/10 text-warning",
  "Ожидает": "border-warning/30 bg-warning/10 text-warning",
  "Предварительно": "border-warning/30 bg-warning/10 text-warning",
  "Можно закрыть": "border-success/30 bg-success/10 text-success",
  APPROVED: "border-success/30 bg-success/10 text-success",
  "Одобрена": "border-success/30 bg-success/10 text-success",
  "Одобрен": "border-success/30 bg-success/10 text-success",
  "Закрыта": "border-success/30 bg-success/10 text-success",
  REJECTED: "border-danger/30 bg-danger/10 text-danger",
  "Отклонена": "border-danger/30 bg-danger/10 text-danger",
  "Отклонён": "border-danger/30 bg-danger/10 text-danger",
  "Отклонено": "border-danger/30 bg-danger/10 text-danger",
  PAID: "border-accent-2/30 bg-accent-2/10 text-accent-2",
  "Оплачена": "border-accent-2/30 bg-accent-2/10 text-accent-2",
  "Оплачено": "border-accent-2/30 bg-accent-2/10 text-accent-2",
  "К выводу": "border-accent-2/30 bg-accent-2/10 text-accent-2",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${colors[status] ?? "border-border bg-surface-2 text-muted"}`}>{labels[status] ?? status}</span>;
}
