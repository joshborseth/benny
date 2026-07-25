import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@benny/backend/api";
import { Button } from "@benny/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@benny/ui/components/card";

export const Route = createFileRoute("/")({
  component: Home,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.tasks.get, {}));
  },
});

function Home() {
  const { data } = useSuspenseQuery(convexQuery(api.tasks.get, {}));

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Benny</CardTitle>
          <CardDescription>TanStack Start + Convex + shadcn/ui monorepo starter.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="space-y-2 text-sm">
            {data.map((task) => (
              <li key={task._id} className="flex items-center gap-2">
                <span
                  className={task.isCompleted ? "text-muted-foreground line-through" : undefined}
                >
                  {task.text}
                </span>
              </li>
            ))}
          </ul>
          <Button type="button">Ready</Button>
        </CardContent>
      </Card>
    </main>
  );
}
