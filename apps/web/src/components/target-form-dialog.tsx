import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { api } from "@benny/backend/api";
import type { Id } from "@benny/backend/dataModel";
import { Button } from "@benny/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@benny/ui/components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@benny/ui/components/field";
import { Input } from "@benny/ui/components/input";
import { Switch } from "@benny/ui/components/switch";
import {
  emptyTargetFormValues,
  targetFormSchema,
  type TargetFormValues,
} from "@/lib/schemas/target-form";

type TargetFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  targetId?: Id<"targets">;
  defaultValues?: TargetFormValues;
};

function TargetFormFields({
  mode,
  targetId,
  defaultValues,
  onOpenChange,
}: {
  mode: "create" | "edit";
  targetId?: Id<"targets">;
  defaultValues: TargetFormValues;
  onOpenChange: (open: boolean) => void;
}) {
  const createTarget = useMutation(api.targets.create);
  const updateTarget = useMutation(api.targets.update);
  const upsertCredentials = useMutation(api.credentials.upsert);
  const credStatus = useQuery(api.credentials.statusByTarget, targetId ? { targetId } : "skip");

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: targetFormSchema,
    },
    onSubmit: async ({ value }) => {
      const url = value.url.trim();
      const { enabled } = value;
      const username = value.username.trim();
      const password = value.password;

      let id = targetId;
      if (mode === "edit" && targetId) {
        await updateTarget({ id: targetId, url, enabled });
      } else {
        id = await createTarget({ url, enabled });
      }

      if (id && username && password) {
        await upsertCredentials({ targetId: id, username, password });
      }

      onOpenChange(false);
    },
  });

  return (
    <>
      <form
        id="target-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="url">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>URL</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="url"
                    placeholder="https://example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                    autoFocus
                    className="font-mono text-[13px]"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="username">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  autoComplete="off"
                  placeholder={
                    credStatus?.hasCredentials ? "Leave blank to keep existing" : "optional"
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="font-mono text-[13px]"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    credStatus?.hasCredentials ? "Leave blank to keep existing" : "optional"
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="font-mono text-[13px]"
                />
                <FieldDescription>
                  Stored encrypted at rest. Both username and password are required to update
                  credentials.
                </FieldDescription>
              </Field>
            )}
          </form.Field>
          <form.Field name="enabled">
            {(field) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Enabled</FieldLabel>
                  <FieldDescription>
                    Mark this target as active for background scraping.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
        </FieldGroup>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" form="target-form" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add target"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
}

export function TargetFormDialog({
  open,
  onOpenChange,
  mode,
  targetId,
  defaultValues = emptyTargetFormValues,
}: TargetFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit target" : "Add target"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update this scrape target and optional login credentials."
              : "Add a URL and optional credentials for the AI browser agent."}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <TargetFormFields
            key={`${mode}-${targetId ?? "new"}`}
            mode={mode}
            targetId={targetId}
            defaultValues={defaultValues}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
