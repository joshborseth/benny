import { z } from "zod";

export const urlFormSchema = z.object({
  url: z.url("Enter a valid URL"),
  enabled: z.boolean(),
});

export type UrlFormValues = z.infer<typeof urlFormSchema>;

export const emptyUrlFormValues: UrlFormValues = {
  url: "",
  enabled: true,
};
