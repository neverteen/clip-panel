export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted sm:text-base">{description}</p>}
    </header>
  );
}
