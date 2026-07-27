import { z } from "zod";

export const targetFormSchema = z.object({
  url: z.url("Enter a valid URL"),
  enabled: z.boolean(),
  username: z.string(),
  password: z.string(),
});

export type TargetFormValues = z.infer<typeof targetFormSchema>;

export const emptyTargetFormValues: TargetFormValues = {
  url: "",
  enabled: true,
  username: "",
  password: "",
};
