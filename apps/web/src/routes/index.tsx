import { useMemo, useState } from "react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { api } from "@benny/backend/api";
import type { Doc, Id } from "@benny/backend/dataModel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@benny/ui/components/alert-dialog";
import { Badge } from "@benny/ui/components/badge";
import { Button } from "@benny/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@benny/ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@benny/ui/components/table";
import { RunStatusBadge } from "@/components/run-status-badge";
import { TargetFormDialog } from "@/components/target-form-dialog";
import { useEnterAnimation } from "@/hooks/use-enter-animation";
import { emptyTargetFormValues, type TargetFormValues } from "@/lib/schemas/target-form";

export const Route = createFileRoute("/")({
  component: TargetsPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.targets.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.runs.listRecent, {})),
    ]);
  },
});

function formatCreatedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function lastTraceLine(trace: string | undefined) {
  if (!trace) {
    return undefined;
  }
  const lines = trace.split("\n").filter((line) => line.trim().length > 0);
  return lines.at(-1);
}

function CredentialBadge({ targetId }: { targetId: Id<"targets"> }) {
  const status = useQuery(api.credentials.statusByTarget, { targetId });
  if (status === undefined) {
    return <span className="font-mono text-xs text-muted-foreground">…</span>;
  }
  return (
    <Badge variant={status.hasCredentials ? "default" : "secondary"}>
      {status.hasCredentials ? "Set" : "None"}
    </Badge>
  );
}

type DialogState = { type: "closed" } | { type: "create" } | { type: "edit"; row: Doc<"targets"> };

function TargetsPage() {
  const navigate = useNavigate();
  const { data: targets } = useSuspenseQuery(convexQuery(api.targets.list, {}));
  const { data: runs } = useSuspenseQuery(convexQuery(api.runs.listRecent, {}));
  const removeTarget = useMutation(api.targets.remove);
  const enqueueRun = useMutation(api.runs.enqueue);

  const runIds = useMemo(() => runs.map((run) => run._id), [runs]);
  const isNewRun = useEnterAnimation(runIds);

  const [dialog, setDialog] = useState<DialogState>({ type: "closed" });
  const [deleteId, setDeleteId] = useState<Id<"targets"> | null>(null);
  const [enqueueingId, setEnqueueingId] = useState<Id<"targets"> | null>(null);

  const formDefaults: TargetFormValues =
    dialog.type === "edit"
      ? {
          url: dialog.row.url,
          enabled: dialog.row.enabled,
          username: "",
          password: "",
        }
      : emptyTargetFormValues;

  const targetById = new Map(targets.map((t) => [t._id, t]));

  return (
    <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="animate-fade-up flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="font-mono text-[11px] tracking-[0.22em] text-primary uppercase">Benny</p>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-balance">
            Scrape targets
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            Configure sites for the AI browser worker. Enqueue a run, then start{" "}
            <code className="font-mono text-xs">bun run worker</code> with your OpenAI key.
          </p>
        </div>
        <Button type="button" onClick={() => setDialog({ type: "create" })}>
          <PlusIcon data-icon="inline-start" />
          Add target
        </Button>
      </header>

      <section
        className="animate-fade-up rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm"
        style={{ animationDelay: "80ms" }}
      >
        {targets.length === 0 ? (
          <Empty className="border-0 py-20">
            <EmptyHeader>
              <EmptyTitle>No targets yet</EmptyTitle>
              <EmptyDescription>Add a URL and optional login credentials.</EmptyDescription>
            </EmptyHeader>
            <Button type="button" onClick={() => setDialog({ type: "create" })}>
              <PlusIcon data-icon="inline-start" />
              Add target
            </Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  URL
                </TableHead>
                <TableHead className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  Creds
                </TableHead>
                <TableHead className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  Enabled
                </TableHead>
                <TableHead className="w-36 px-4 text-right font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((row) => (
                <TableRow key={row._id} className="hover:bg-accent/40">
                  <TableCell className="px-4 py-3">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[13px] text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      {row.url}
                    </a>
                  </TableCell>
                  <TableCell>
                    <CredentialBadge targetId={row._id} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.enabled ? "On" : "Off"}
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Run scrape for ${row.url}`}
                        disabled={enqueueingId === row._id}
                        onClick={() => {
                          setEnqueueingId(row._id);
                          void enqueueRun({ targetId: row._id }).finally(() =>
                            setEnqueueingId(null),
                          );
                        }}
                      >
                        <PlayIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${row.url}`}
                        onClick={() => setDialog({ type: "edit", row })}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${row.url}`}
                        onClick={() => setDeleteId(row._id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="animate-fade-up space-y-3" style={{ animationDelay: "140ms" }}>
        <h2 className="font-heading text-lg font-medium tracking-tight">Recent runs</h2>
        <div className="rounded-lg border border-border/80 bg-card/80 shadow-[0_1px_0_oklch(0.92_0.01_230)] backdrop-blur-sm">
          {runs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No runs yet. Hit play on a target to enqueue one.
            </p>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[34%] px-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Target
                  </TableHead>
                  <TableHead className="w-[14%] px-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Status
                  </TableHead>
                  <TableHead className="w-[18%] px-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Created
                  </TableHead>
                  <TableHead className="w-[34%] px-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Progress / error
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const target = targetById.get(run.targetId);
                  const detail =
                    run.status === "failed"
                      ? run.error
                      : lastTraceLine(run.trace);
                  return (
                    <TableRow
                      key={run._id}
                      className={`cursor-pointer hover:bg-accent/40${isNewRun(run._id) ? " animate-fade-in" : ""}`}
                      onClick={() =>
                        void navigate({ to: "/runs/$runId", params: { runId: run._id } })
                      }
                    >
                      <TableCell className="max-w-0 px-3 py-2.5 font-mono text-[13px] whitespace-normal">
                        <span className="line-clamp-2 wrap-break-word">
                          {target?.url ?? String(run.targetId)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-0 px-2 py-2.5 align-middle">
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="max-w-0 px-2 py-2.5 font-mono text-xs whitespace-normal wrap-break-word text-muted-foreground">
                        {formatCreatedAt(run._creationTime)}
                      </TableCell>
                      <TableCell className="max-w-0 px-3 py-2.5 font-mono text-xs whitespace-normal text-muted-foreground">
                        {detail ? (
                          <span key={detail} className="animate-fade-in line-clamp-2 wrap-break-word">
                            {detail}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <TargetFormDialog
        open={dialog.type !== "closed"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog({ type: "closed" });
          }
        }}
        mode={dialog.type === "edit" ? "edit" : "create"}
        targetId={dialog.type === "edit" ? dialog.row._id : undefined}
        defaultValues={formDefaults}
      />

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete target?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the target, its credentials, and run history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteId) {
                  void removeTarget({ id: deleteId }).then(() => setDeleteId(null));
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
