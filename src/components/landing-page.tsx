import Link from "next/link";
import { Button, Card, PageHeader } from "@/components/ui";
import { landingContent } from "@/content/landing";

type LandingNumbers = {
  rateCentsPer1000: number;
  minVideoViews: number;
  minWeekViews: number;
  payoutThresholdCents: number;
  maxAccountsPerPlatform: number;
  maxSubmissionsPerWeek: number;
};

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => values[key] ?? "");
}

export function LandingPage({
  login,
  dashboardHref,
  numbers,
}: {
  login: string | null;
  dashboardHref: string | null;
  numbers: LandingNumbers;
}) {
  const { hero, process, rules, payment, faq } = landingContent;
  const minimumWeekCents = Math.floor(numbers.minWeekViews * numbers.rateCentsPer1000 / 1000);
  const exampleCents = Math.floor(numbers.minVideoViews * numbers.rateCentsPer1000 / 1000);
  const textValues = {
    login: login ?? "",
    views: formatInteger(numbers.minVideoViews),
    weekViews: formatInteger(numbers.minWeekViews),
    rate: `${formatInteger(numbers.rateCentsPer1000)} ${payment.centsUnit}`,
    amount: formatMoney(exampleCents),
    payoutThreshold: formatMoney(numbers.payoutThresholdCents),
    minimumWeekAmount: formatMoney(minimumWeekCents),
    accountLimit: formatInteger(numbers.maxAccountsPerPlatform),
    submissionLimit: formatInteger(numbers.maxSubmissionsPerWeek),
  };
  const example = fill(payment.example, textValues);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-7 px-4 py-6 sm:px-6 sm:py-10">
      <Card className="relative overflow-hidden p-6 sm:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative max-w-3xl space-y-5">
          <p className="font-heading text-sm font-semibold tracking-[0.22em] text-accent-2">{hero.eyebrow}</p>
          <PageHeader title={hero.title} description={hero.description} />
          {dashboardHref ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link href={dashboardHref}><Button size="lg">{hero.dashboard}</Button></Link>
              {login && <span className="text-sm text-muted">{fill(hero.signedInAs, textValues)}</span>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/login"><Button size="lg">{hero.signIn}</Button></Link>
              <span className="text-sm text-muted">{hero.access}</span>
            </div>
          )}
        </div>
      </Card>

      <section className="space-y-4">
        <PageHeader title={process.title} />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {process.steps.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full space-y-2 p-5">
                <p className="text-xs font-semibold text-accent-2">{fill(process.stepLabel, { number: String(index + 1) })}</p>
                <h3 className="font-heading text-lg font-semibold">{step.title}</h3>
                <p className="text-sm leading-6 text-muted">{step.description}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <PageHeader title={rules.title} description={rules.intro} />
        <Card className="space-y-3 p-5 sm:p-6">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
            {rules.items.map((item) => <li key={item}>{fill(item, textValues)}</li>)}
            <li>{rules.sourceIntegrity}</li>
            <li>{rules.screenshot}</li>
          </ul>
        </Card>
      </section>

      <section className="space-y-4">
        <PageHeader title={payment.title} />
        <Card className="space-y-5 p-5 sm:p-6">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label={payment.ratePerThousand} value={textValues.rate} />
            <Metric label={payment.videoMinimum} value={formatInteger(numbers.minVideoViews)} />
            <Metric label={payment.weekMinimum} value={formatInteger(numbers.minWeekViews)} />
            <Metric label={payment.payoutMinimum} value={formatMoney(numbers.payoutThresholdCents)} />
            <Metric label={payment.accountsLimit} value={formatInteger(numbers.maxAccountsPerPlatform)} />
            <Metric label={payment.submissionsLimit} value={formatInteger(numbers.maxSubmissionsPerWeek)} />
          </dl>
          <p className="rounded-lg border border-accent/30 bg-accent/10 p-4 text-sm text-text">{example}</p>
          <div className="space-y-2">
            <h3 className="font-heading text-lg font-semibold">{payment.carryTitle}</h3>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
              {payment.carryRules.map((rule) => <li key={rule}>{fill(rule, textValues)}</li>)}
            </ul>
          </div>
          <p className="text-sm text-muted">{payment.methods}</p>
        </Card>
      </section>

      <section className="space-y-4">
        <PageHeader title={faq.title} />
        <div className="space-y-2">
          {faq.items.map((item) => (
            <details className="group rounded-xl border border-border bg-surface px-4" key={item.question}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span><span aria-hidden="true" className="text-accent-2 group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 text-sm leading-6 text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-surface-2 p-4">
    <dt className="text-sm text-muted">{label}</dt>
    <dd className="mt-1 break-words font-heading text-lg font-semibold text-text">{value}</dd>
  </div>;
}
