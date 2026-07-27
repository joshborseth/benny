import type { Doc } from "@benny/backend/dataModel";
import { Badge } from "@benny/ui/components/badge";

export function RunStatusBadge({ status }: { status: Doc<"runs">["status"] }) {
  const variant =
    status === "succeeded"
      ? "default"
      : status === "failed"
        ? "destructive"
        : status === "running"
          ? "outline"
          : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
