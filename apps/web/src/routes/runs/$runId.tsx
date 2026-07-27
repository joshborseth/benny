import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { api } from "@benny/backend/api";
import type { Id } from "@benny/backend/dataModel";
import { Button } from "@benny/ui/components/button";
import { RunStatusBadge } from "@/components/run-status-badge";

export const Route = createFileRoute("/runs/$runId")({
  component: RunDetailPage,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.runs.get, { id: params.runId as Id<"runs"> }),
    );
  },
});

function formatTimestamp(timestamp: number | undefined) {
  if (timestamp === undefined) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { data: run } = useSuspenseQuery(
    convexQuery(api.runs.get, { id: runId as Id<"runs"> }),
  );

  if (!run) {
    return (
      <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
        <div className="space-y-2">
          <p className="font-mono text-[11px] tracking-[0.22em] text-primary uppercase">Benny</p>
          <h1 className="font-heading text-3xl font-medium tracking-tight">Run not found</h1>
          <p className="text-sm text-muted-foreground">
            This run may have been deleted with its target.
          </p>
        </div>
      </main>
    );
  }

  const jsonPayload =
    run.result !== undefined
      ? run.result
      : run.error !== undefined
        ? { error: run.error }
        : null;

  return (
    <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="animate-fade-up space-y-4">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="font-mono text-[11px] tracking-[0.22em] text-primary uppercase">Benny</p>
            <h1 className="font-heading text-3xl font-medium tracking-tight">Run detail</h1>
            <p className="font-mono text-xs text-muted-foreground break-all">{run._id}</p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
      </header>

      <section
        className="animate-fade-up rounded-lg border border-border/80 bg-card/80 p-4 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm md:p-5"
        style={{ animationDelay: "60ms" }}
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              Target
            </dt>
            <dd className="font-mono text-sm break-all">
              {run.target ? (
                <a
                  href={run.target.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  {run.target.url}
                </a>
              ) : (
                String(run.targetId)
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              Created
            </dt>
            <dd className="font-mono text-sm text-muted-foreground">
              {formatTimestamp(run._creationTime)}
            </dd>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              Goal
            </dt>
            <dd className="text-sm text-muted-foreground">
              {run.target?.goal ?? "—"}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              Started
            </dt>
            <dd className="font-mono text-sm text-muted-foreground">
              {formatTimestamp(run.startedAt)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              Finished
            </dt>
            <dd className="font-mono text-sm text-muted-foreground">
              {formatTimestamp(run.finishedAt)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="animate-fade-up space-y-3" style={{ animationDelay: "120ms" }}>
        <h2 className="font-heading text-lg font-medium tracking-tight">Extracted JSON</h2>
        <div className="overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm">
          {jsonPayload !== null ? (
            <pre className="max-h-[min(70vh,48rem)] overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap wrap-break-word">
              {JSON.stringify(jsonPayload, null, 2)}
            </pre>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {run.status === "pending" || run.status === "running"
                ? "No result yet — this run is still in progress."
                : "No extracted data for this run."}
            </p>
          )}
        </div>
      </section>

      {run.trace ? (
        <section className="animate-fade-up space-y-3" style={{ animationDelay: "180ms" }}>
          <h2 className="font-heading text-lg font-medium tracking-tight">Trace</h2>
          <div className="overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm">
            <pre className="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap wrap-break-word">
              {run.trace}
            </pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}
