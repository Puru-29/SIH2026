import { createFileRoute } from "@tanstack/react-router";
import { FpoLayout } from "@/components/fpo/fpo-layout";

export const Route = createFileRoute("/fpo")({
  head: () => ({
    meta: [
      { title: "FPO Portal — AgriSense" },
      {
        name: "description",
        content:
          "Run your Farmer Producer Organisation: members, crop pooling, bulk lots, buyer offers, logistics and farmer payments.",
      },
    ],
  }),
  component: FpoLayout,
});
