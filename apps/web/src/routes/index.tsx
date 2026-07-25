import { useState } from "react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { Button } from "@benny/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@benny/ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@benny/ui/components/table";
import { UrlFormDialog } from "@/components/url-form-dialog";
import { emptyUrlFormValues, type UrlFormValues } from "@/lib/url-form-schema";

export const Route = createFileRoute("/")({
  component: UrlsPage,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.urls.list, {}));
  },
});

function formatCreatedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

type DialogState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; row: Doc<"urls"> };

function UrlsPage() {
  const { data: urls } = useSuspenseQuery(convexQuery(api.urls.list, {}));
  const removeUrl = useMutation(api.urls.remove);

  const [dialog, setDialog] = useState<DialogState>({ type: "closed" });
  const [deleteId, setDeleteId] = useState<Id<"urls"> | null>(null);

  const formDefaults: UrlFormValues =
    dialog.type === "edit" ? { url: dialog.row.url } : emptyUrlFormValues;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-medium tracking-tight">Scrape URLs</h1>
          <p className="text-sm text-muted-foreground">
            Manage URLs you plan to scrape. Scraping itself is not wired up yet.
          </p>
        </div>
        <Button type="button" onClick={() => setDialog({ type: "create" })}>
          <PlusIcon data-icon="inline-start" />
          Add URL
        </Button>
      </header>

      {urls.length === 0 ? (
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyTitle>No URLs yet</EmptyTitle>
            <EmptyDescription>Add a URL to start building your scrape list.</EmptyDescription>
          </EmptyHeader>
          <Button type="button" onClick={() => setDialog({ type: "create" })}>
            <PlusIcon data-icon="inline-start" />
            Add URL
          </Button>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {urls.map((row) => (
              <TableRow key={row._id}>
                <TableCell>
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.url}
                  </a>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatCreatedAt(row._creationTime)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1">
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

      <UrlFormDialog
        open={dialog.type !== "closed"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog({ type: "closed" });
          }
        }}
        mode={dialog.type === "edit" ? "edit" : "create"}
        urlId={dialog.type === "edit" ? dialog.row._id : undefined}
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
            <AlertDialogTitle>Delete URL?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the URL from your scrape list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteId) {
                  void removeUrl({ id: deleteId }).then(() => setDeleteId(null));
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
