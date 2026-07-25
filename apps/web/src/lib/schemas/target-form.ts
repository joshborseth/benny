import { z } from "zod";

export const targetFormSchema = z.object({
  url: z.url("Enter a valid URL"),
  goal: z.string().min(1, "Describe what to scrape"),
  enabled: z.boolean(),
  username: z.string(),
  password: z.string(),
});

export type TargetFormValues = z.infer<typeof targetFormSchema>;

export const emptyTargetFormValues: TargetFormValues = {
  url: "",
  goal: "",
  enabled: true,
  username: "",
  password: "",
};
