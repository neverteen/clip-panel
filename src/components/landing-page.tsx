import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { landingContent } from "@/content/landing";
import type { LandingPayoutRow } from "@/lib/landing-payout-table";
import { CopyDescriptionButton } from "./copy-description-button";

type LandingNumbers = {
  rateCentsPer1000: number;
  minVideoViews: number;
  minWeekViews: number;
  payoutThresholdCents: number;
  maxAccountsTotal: number;
  maxAccountsPerPlatform: number;
  maxSubmissionsPerWeek: number;
  payoutSlaDays: number;
};

function formatMoney(cents: number) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars.toLocaleString("en-US")}` : `$${dollars.toFixed(2)}`;
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
  payoutRows,
}: {
  login: string | null;
  dashboardHref: string | null;
  numbers: LandingNumbers;
  payoutRows: LandingPayoutRow[];
}) {
  const { anchors, navigation, hero, payment, start, rules, savings, faq, footer } = landingContent;
  const values = {
    login: login ?? "",
    minVideoViews: formatInteger(numbers.minVideoViews),
    minWeekViews: formatInteger(numbers.minWeekViews),
    rate: formatMoney(numbers.rateCentsPer1000),
    maxAccountsTotal: formatInteger(numbers.maxAccountsTotal),
    maxAccountsPerPlatform: formatInteger(numbers.maxAccountsPerPlatform),
    maxSubmissionsPerWeek: formatInteger(numbers.maxSubmissionsPerWeek),
    payoutThreshold: formatMoney(numbers.payoutThresholdCents),
    days: String(numbers.payoutSlaDays),
  };
  const mobileLinks = navigation.sections.map((item) => ({ ...item, href: `#${anchors[item.anchor]}` }));
  const tableOfContents = [
    { label: payment.title, href: `#${anchors.payment}` },
    { label: rules.channelTitle, href: `#${anchors.channelRules}` },
    { label: rules.serviceTitle, href: `#${anchors.serviceTerms}` },
    { label: start.title, href: `#${anchors.start}` },
    { label: faq.title, href: `#${anchors.faq}` },
  ];

  return (
    <div className="min-h-screen">
      <header className="landing-topbar sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link className="shrink-0 font-heading text-sm font-bold tracking-[0.16em] text-text sm:text-base" href="/">{hero.brand}</Link>
          <nav aria-label={navigation.desktopAriaLabel} className="hidden items-center gap-1 lg:flex">
            {mobileLinks.map((item) => <a className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-text" href={item.href} key={item.anchor}>{item.label}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            <details className="relative lg:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-accent-2 [&::-webkit-details-marker]:hidden">{navigation.openMenu}</summary>
              <nav aria-label={navigation.mobileAriaLabel} className="absolute right-0 top-12 z-50 w-56 space-y-1 rounded-xl border border-border bg-surface p-2 shadow-2xl">
                {mobileLinks.map((item) => <a className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:bg-surface-2 hover:text-text" href={item.href} key={item.anchor}>{item.label}</a>)}
              </nav>
            </details>
            <Link href={dashboardHref ?? "/login"}>
              <Button size="sm">{dashboardHref ? hero.dashboard : hero.signIn}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero-glow relative overflow-hidden border-b border-border/70">
          <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
            <div className="max-w-4xl space-y-6">
              <p className="font-heading text-xs font-semibold tracking-[0.24em] text-accent-2 sm:text-sm">{hero.eyebrow}</p>
              <h1 className="max-w-4xl break-words font-heading text-4xl font-semibold leading-[1.06] tracking-tight text-text sm:text-6xl">{hero.title}</h1>
              <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">{hero.description}</p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href={`#${anchors.start}`}><Button size="lg" variant="primary">{hero.start}</Button></Link>
                {dashboardHref ? <span className="text-sm text-muted">{fill(hero.signedInAs, values)}</span> : <span className="text-sm text-muted">{hero.guestNote}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-5 sm:grid-cols-4 sm:gap-3">
              {hero.badges.map((badge) => (
                  <div className="rounded-xl border border-border/90 bg-surface/80 px-3 py-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)] sm:px-4" key={badge}>
                    <p className="font-heading text-base font-semibold text-text sm:text-lg">{fill(badge, values)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <aside className="sticky top-24 hidden h-fit lg:block">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{navigation.tableOfContents}</p>
            <nav aria-label={navigation.tableOfContentsAriaLabel} className="space-y-1 border-l border-border pl-2">
              {tableOfContents.map((item) => <a className="flex min-h-10 items-center rounded-r-lg px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-accent-2" href={item.href} key={item.href}>{item.label}</a>)}
            </nav>
          </aside>

          <div className="min-w-0 space-y-16 sm:space-y-20">
            <section className="landing-reveal landing-anchor space-y-5" id={anchors.payment}>
              <SectionHeading eyebrow={payment.rateUnit} title={payment.title} description={fill(payment.intro, values)} />
              <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-text shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_18%,transparent)]">{payment.oneVideoOnePayment}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {payoutRows.map((row, index) => (
                  <Card className={`relative overflow-hidden p-4 sm:p-5 ${index === payoutRows.length - 1 ? "border-accent/60 shadow-[0_0_28px_color-mix(in_srgb,var(--accent)_24%,transparent)]" : ""}`} key={row.views}>
                    {index === payoutRows.length - 1 && <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full bg-accent/15 blur-2xl" />}
                    <p className="relative text-xs font-medium text-muted sm:text-sm">{payment.viewsLabel}</p>
                    <p className="relative mt-2 font-heading text-xl font-semibold text-text sm:text-2xl">{formatInteger(row.views)}</p>
                    <p className="relative mt-3 text-xs font-medium text-muted sm:text-sm">{payment.amountLabel}</p>
                    <p className="relative font-heading text-2xl font-semibold text-accent-2 sm:text-3xl">{formatMoney(row.amountCents)}</p>
                  </Card>
                ))}
              </div>
              <Card className="flex flex-col gap-3 border-accent/30 bg-surface-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-text">{fill(payment.sla, values)}</p>
                <p className="shrink-0 text-sm text-muted">{payment.methods}</p>
              </Card>
            </section>

            <section className="landing-reveal landing-anchor space-y-5" id={anchors.rules}>
              <SectionHeading eyebrow={rules.intro} title={rules.title} />
              <section className="landing-anchor space-y-5" id={anchors.channelRules}>
                <SectionHeading title={rules.channelTitle} description={rules.channelIntro} small />
                <Card className="space-y-4">
                  <h3 className="font-heading text-lg font-semibold text-text">{rules.generalTitle}</h3>
                  <BulletList items={rules.general.map((item) => fill(item, values))} />
                </Card>

                <Card className="space-y-4">
                  <h3 className="font-heading text-lg font-semibold text-text">{rules.accountChangeTitle}</h3>
                  <p className="text-sm leading-6 text-muted">{rules.accountChangeIntro}</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 font-sans text-sm leading-6 text-text">{rules.accountChangeTemplate}</pre>
                </Card>

                <Card className="space-y-4">
                  <h3 className="font-heading text-lg font-semibold text-text">{rules.profileTitle}</h3>
                  <p className="text-sm leading-6 text-muted">{rules.profileIntro}</p>
                  <div className="rounded-xl border border-border bg-background p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{rules.profileTemplateLabel}</p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-text">{rules.profileTemplate}</pre>
                    <div className="mt-3"><CopyDescriptionButton text={rules.profileTemplate} labels={{ copy: rules.copy, copied: rules.copied, error: rules.copyError }} /></div>
                  </div>
                  <ul className="space-y-2 text-sm leading-6 text-muted">
                    <li>{rules.tiktokDescription}</li>
                    <li>{rules.otherPlatformDescription}</li>
                    <li>{rules.profileNote}</li>
                  </ul>
                </Card>

                <Card className="space-y-4">
                  <h3 className="font-heading text-lg font-semibold text-text">{rules.otherCreatorsTitle}</h3>
                  <BulletList items={rules.otherCreators} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CodeNote label={rules.promoFormatLabel} text={rules.promoFormat} />
                    <CodeNote label={rules.promoExampleLabel} text={rules.promoExample} />
                  </div>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="space-y-4 border-success/40 bg-success/5">
                    <h3 className="font-heading text-lg font-semibold text-success">{rules.requiredTitle}</h3>
                    <BulletList items={rules.required} tone="success" />
                  </Card>
                  <Card className="space-y-4 border-danger/40 bg-danger/5">
                    <h3 className="font-heading text-lg font-semibold text-danger">{rules.prohibitedTitle}</h3>
                    <BulletList items={rules.prohibited} tone="danger" />
                  </Card>
                </div>

                <Card className="space-y-4">
                  <h3 className="font-heading text-lg font-semibold text-text">{rules.tipsTitle}</h3>
                  <BulletList items={rules.tips} />
                </Card>
              </section>

              <section className="landing-anchor space-y-5" id={anchors.serviceTerms}>
                <SectionHeading title={rules.serviceTitle} description={rules.serviceIntro} small />
                <Card className="space-y-4 border-accent/30">
                  <BulletList items={rules.service.map((item) => fill(item, values))} />
                  <div className="rounded-xl border border-border bg-surface-2 p-4">
                    <h3 className="mb-3 font-heading text-base font-semibold text-text">{savings.title}</h3>
                    <ul className="space-y-2 text-sm leading-6 text-muted">
                      <li>{fill(savings.minWeek, values)}</li>
                      <li>{fill(savings.carry, values)}</li>
                      <li>{fill(savings.release, values)}</li>
                      <li>{fill(savings.expire, values)}</li>
                      <li>{fill(savings.newAccountDay, values)}</li>
                    </ul>
                  </div>
                </Card>
              </section>
            </section>

            <section className="landing-reveal landing-anchor space-y-5" id={anchors.start}>
              <SectionHeading eyebrow={start.intro} title={start.title} />
              <ol className="relative space-y-3 before:absolute before:bottom-7 before:left-[1.35rem] before:top-7 before:w-px before:bg-border">
                {start.steps.map((step, index) => (
                  <li className="relative flex gap-4" key={step}>
                    <span className="z-10 flex size-11 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-surface-2 font-heading font-semibold text-accent-2 shadow-[0_0_18px_color-mix(in_srgb,var(--accent)_14%,transparent)]">{index + 1}</span>
                    <Card className="min-w-0 flex-1 py-3.5 text-sm leading-6 text-text">{step}</Card>
                  </li>
                ))}
              </ol>
              <Link className="inline-flex" href="https://t.me/tapenarezki" rel="noopener noreferrer" target="_blank"><Button variant="secondary">{start.managerLabel}</Button></Link>
            </section>

            <section className="landing-reveal landing-anchor space-y-5" id={anchors.faq}>
              <SectionHeading title={faq.title} />
              <div className="space-y-2">
                {faq.items.map((item) => (
                  <details className="group rounded-xl border border-border bg-surface px-4" key={item.question}>
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2 [&::-webkit-details-marker]:hidden">
                      <span>{item.question}</span><span aria-hidden="true" className="text-accent-2 transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="pb-4 text-sm leading-6 text-muted">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-border bg-surface/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs leading-5 text-muted">{footer.sourceNote}</p>
          <div className="flex flex-wrap gap-4">
            <a className="min-h-11 content-center text-accent-2 underline-offset-4 hover:underline" href="https://t.me/tapenarezki" rel="noopener noreferrer" target="_blank">{footer.manager}</a>
            <a className="min-h-11 content-center text-accent-2 underline-offset-4 hover:underline" href="https://t.me/closetaNAREZKA/37" rel="noopener noreferrer" target="_blank">{footer.rules}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, small = false }: { eyebrow?: string; title: string; description?: string; small?: boolean }) {
  return <header className="space-y-2">
    {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-2">{eyebrow}</p>}
    <h2 className={`break-words font-heading font-semibold tracking-tight text-text ${small ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl"}`}>{title}</h2>
    {description && <p className="max-w-3xl text-sm leading-6 text-muted sm:text-base">{description}</p>}
  </header>;
}

function BulletList({ items, tone = "muted" }: { items: readonly string[]; tone?: "muted" | "success" | "danger" }) {
  const marker = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-accent-2";
  return <ul className="space-y-2 text-sm leading-6 text-muted">
    {items.map((item) => <li className="flex gap-2" key={item}><span aria-hidden="true" className={`${marker} select-none`}>•</span><span className="min-w-0">{item}</span></li>)}
  </ul>;
}

function CodeNote({ label, text }: { label: string; text: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-background p-3">
    <p className="text-xs text-muted">{label}</p>
    <p className="mt-1 break-words font-mono text-sm text-text">{text}</p>
  </div>;
}
