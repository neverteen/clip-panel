const labels: Record<string, string> = {
  PENDING: "На проверке",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  PAID: "Оплачена",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className="rounded-full bg-[var(--muted)] px-3 py-1 text-sm">{labels[status] ?? status}</span>;
}
