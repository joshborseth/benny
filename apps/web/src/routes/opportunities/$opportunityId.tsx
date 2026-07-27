import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@benny/backend/api";
import type { Id } from "@benny/backend/dataModel";
import { Button } from "@benny/ui/components/button";

export const Route = createFileRoute("/opportunities/$opportunityId")({
  component: OpportunityDetailPage,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.opportunities.get, {
        id: params.opportunityId as Id<"opportunities">,
      }),
    );
  },
});

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm wrap-break-word">{children}</dd>
    </div>
  );
}

function OpportunityDetailPage() {
  const { opportunityId } = Route.useParams();
  const { data: opportunity } = useSuspenseQuery(
    convexQuery(api.opportunities.get, {
      id: opportunityId as Id<"opportunities">,
    }),
  );

  if (!opportunity) {
    return (
      <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
        <div className="space-y-2">
          <p className="font-mono text-[11px] tracking-[0.22em] text-primary uppercase">Benny</p>
          <h1 className="font-heading text-3xl font-medium tracking-tight">
            Opportunity not found
          </h1>
          <p className="text-sm text-muted-foreground">
            This opportunity may have been deleted with its run or target.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="animate-fade-up space-y-4">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={
            <Link to="/runs/$runId" params={{ runId: opportunity.runId }} />
          }
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to run
        </Button>
        <div className="space-y-2">
          <p className="font-mono text-[11px] tracking-[0.22em] text-primary uppercase">Benny</p>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-balance">
            {opportunity.title}
          </h1>
          <p className="font-mono text-xs text-muted-foreground break-all">
            {opportunity._id}
          </p>
        </div>
        {opportunity.url ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={opportunity.url} target="_blank" rel="noreferrer" />
            }
          >
            Open source
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </header>

      <section
        className="animate-fade-up rounded-lg border border-border/80 bg-card/80 p-4 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm md:p-5"
        style={{ animationDelay: "60ms" }}
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Agency">
            <span className="text-muted-foreground">{opportunity.agency ?? "—"}</span>
          </Field>
          <Field label="Deadline">
            <span className="text-muted-foreground">{opportunity.deadline ?? "—"}</span>
          </Field>
          <Field label="Location">
            <span className="text-muted-foreground">{opportunity.location ?? "—"}</span>
          </Field>
          <Field label="Amount">
            <span className="font-mono text-xs text-muted-foreground">
              {opportunity.amount ?? "—"}
            </span>
          </Field>
          <Field label="Target">
            {opportunity.target ? (
              <a
                href={opportunity.target.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {opportunity.target.url}
              </a>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                {String(opportunity.targetId)}
              </span>
            )}
          </Field>
          <Field label="Scraped">
            <span className="font-mono text-xs text-muted-foreground">
              {formatTimestamp(opportunity._creationTime)}
            </span>
          </Field>
          <Field label="URL">
            {opportunity.url ? (
              <a
                href={opportunity.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {opportunity.url}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Run">
            <Link
              to="/runs/$runId"
              params={{ runId: opportunity.runId }}
              className="font-mono text-xs underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              {opportunity.runId}
            </Link>
          </Field>
        </dl>
      </section>

      <section className="animate-fade-up space-y-3" style={{ animationDelay: "120ms" }}>
        <h2 className="font-heading text-lg font-medium tracking-tight">Description</h2>
        <div className="rounded-lg border border-border/80 bg-card/80 p-4 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm md:p-5">
          {opportunity.description ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word text-muted-foreground">
              {opportunity.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No description scraped.</p>
          )}
        </div>
      </section>
    </main>
  );
}
