import { useMemo } from "react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { api } from "@benny/backend/api";
import type { Id } from "@benny/backend/dataModel";
import { Button } from "@benny/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@benny/ui/components/table";
import { RunStatusBadge } from "@/components/run-status-badge";
import { useEnterAnimation } from "@/hooks/use-enter-animation";

export const Route = createFileRoute("/runs/$runId")({
  component: RunDetailPage,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.runs.get, { id: params.runId as Id<"runs"> }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.opportunities.listByRun, { runId: params.runId as Id<"runs"> }),
      ),
    ]);
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
  const navigate = useNavigate();
  const { runId } = Route.useParams();
  const { data: run } = useSuspenseQuery(convexQuery(api.runs.get, { id: runId as Id<"runs"> }));
  const { data: opportunities } = useSuspenseQuery(
    convexQuery(api.opportunities.listByRun, { runId: runId as Id<"runs"> }),
  );

  const opportunityIds = useMemo(
    () => opportunities.map((opportunity) => opportunity._id),
    [opportunities],
  );
  const isNewOpportunity = useEnterAnimation(opportunityIds, runId);

  const traceLines = useMemo(
    () => (run?.trace ? run.trace.split("\n") : []),
    [run?.trace],
  );
  const traceLineKeys = useMemo(
    () => traceLines.map((_, index) => String(index)),
    [traceLines],
  );
  const isNewTraceLine = useEnterAnimation(traceLineKeys, runId);

  const showTrace =
    Boolean(run?.trace) || run?.status === "pending" || run?.status === "running";

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

      {run.error ? (
        <section className="animate-fade-up space-y-3" style={{ animationDelay: "120ms" }}>
          <h2 className="font-heading text-lg font-medium tracking-tight">Error</h2>
          <div className="overflow-hidden rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-mono text-xs leading-relaxed wrap-break-word text-destructive">
              {run.error}
            </p>
          </div>
        </section>
      ) : null}

      <section className="animate-fade-up space-y-3" style={{ animationDelay: "120ms" }}>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-lg font-medium tracking-tight">Opportunities</h2>
          <p className="font-mono text-xs text-muted-foreground">{opportunities.length} found</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm">
          {opportunities.length > 0 ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[34%] px-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Opportunity
                  </TableHead>
                  <TableHead className="w-[18%] px-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Agency
                  </TableHead>
                  <TableHead className="w-[16%] px-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Deadline
                  </TableHead>
                  <TableHead className="w-[16%] px-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Location
                  </TableHead>
                  <TableHead className="w-[16%] px-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((opportunity) => (
                  <TableRow
                    key={opportunity._id}
                    className={`cursor-pointer hover:bg-accent/40${isNewOpportunity(opportunity._id) ? " animate-fade-in" : ""}`}
                    onClick={() =>
                      void navigate({
                        to: "/opportunities/$opportunityId",
                        params: { opportunityId: opportunity._id },
                      })
                    }
                  >
                    <TableCell className="max-w-0 px-3 py-2.5 align-top whitespace-normal">
                      <span className="line-clamp-2 text-sm font-medium">
                        {opportunity.title}
                      </span>
                      {opportunity.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {opportunity.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-0 px-2 py-2.5 align-top text-sm whitespace-normal wrap-break-word text-muted-foreground">
                      {opportunity.agency ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-0 px-2 py-2.5 align-top text-sm whitespace-normal wrap-break-word text-muted-foreground">
                      {opportunity.deadline ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-0 px-2 py-2.5 align-top text-sm whitespace-normal wrap-break-word text-muted-foreground">
                      {opportunity.location ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-0 px-3 py-2.5 align-top font-mono text-xs whitespace-normal wrap-break-word text-muted-foreground">
                      {opportunity.amount ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {run.status === "pending" || run.status === "running"
                ? "No opportunities yet — this run is still in progress."
                : "No opportunities found for this run."}
            </p>
          )}
        </div>
      </section>

      {showTrace ? (
        <section className="animate-fade-up space-y-3" style={{ animationDelay: "180ms" }}>
          <h2 className="font-heading text-lg font-medium tracking-tight">Trace</h2>
          <div className="overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm">
            {traceLines.length > 0 ? (
              <div className="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                {traceLines.map((line, index) => (
                  <p
                    key={index}
                    className={`whitespace-pre-wrap wrap-break-word${isNewTraceLine(String(index)) ? " animate-fade-in" : ""}`}
                  >
                    {line || "\u00a0"}
                  </p>
                ))}
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Waiting for scrape steps…
              </p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
