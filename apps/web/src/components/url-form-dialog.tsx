import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
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
  emptyUrlFormValues,
  urlFormSchema,
  type UrlFormValues,
} from "@/lib/schemas/url-form";

type UrlFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  urlId?: Id<"urls">;
  defaultValues?: UrlFormValues;
};

function UrlFormFields({
  mode,
  urlId,
  defaultValues,
  onOpenChange,
}: {
  mode: "create" | "edit";
  urlId?: Id<"urls">;
  defaultValues: UrlFormValues;
  onOpenChange: (open: boolean) => void;
}) {
  const createUrl = useMutation(api.urls.create);
  const updateUrl = useMutation(api.urls.update);

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: urlFormSchema,
    },
    onSubmit: async ({ value }) => {
      const url = value.url.trim();
      const { enabled } = value;
      if (mode === "edit" && urlId) {
        await updateUrl({ id: urlId, url, enabled });
      } else {
        await createUrl({ url, enabled });
      }
      onOpenChange(false);
    },
  });

  return (
    <>
      <form
        id="url-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field
            name="url"
            children={(field) => {
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
          />
          <form.Field
            name="enabled"
            children={(field) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Enabled</FieldLabel>
                  <FieldDescription>
                    Turn on or off auto background scraping for this URL.
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
          />
        </FieldGroup>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          children={([canSubmit, isSubmitting]) => (
            <Button type="submit" form="url-form" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add URL"}
            </Button>
          )}
        />
      </DialogFooter>
    </>
  );
}

export function UrlFormDialog({
  open,
  onOpenChange,
  mode,
  urlId,
  defaultValues = emptyUrlFormValues,
}: UrlFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit URL" : "Add URL"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update this scrape target."
              : "Add a URL you plan to scrape later."}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <UrlFormFields
            key={`${mode}-${urlId ?? "new"}`}
            mode={mode}
            urlId={urlId}
            defaultValues={defaultValues}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
