import { z } from "zod";

export const urlFormSchema = z.object({
  url: z.url("Enter a valid URL"),
});

export type UrlFormValues = z.infer<typeof urlFormSchema>;

export const emptyUrlFormValues: UrlFormValues = {
  url: "",
};
