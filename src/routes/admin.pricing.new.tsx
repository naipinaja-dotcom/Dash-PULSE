import { createFileRoute } from "@tanstack/react-router";
import { PricingForm } from "@/components/pricing-form";

// Search params opsional — diisi otomatis kalau dibuka dari launcher "Area"
// di form scheme lain (lihat pricing-form.tsx), biar client/City/Model gak
// perlu diisi ulang manual pas bikin scheme terpisah buat area tersebut.
export interface PricingNewSearch {
  clientId?: string;
  cityScope?: string; // comma-separated, langsung ngisi cityScopeRaw
  category?: "delivery" | "attendance";
  revenueShare?: boolean;
}

export const Route = createFileRoute("/admin/pricing/new")({
  component: () => <PricingForm mode="create" initial={Route.useSearch()} />,
  validateSearch: (search: Record<string, unknown>): PricingNewSearch => ({
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    cityScope: typeof search.cityScope === "string" ? search.cityScope : undefined,
    category:
      search.category === "delivery" || search.category === "attendance"
        ? search.category
        : undefined,
    revenueShare: typeof search.revenueShare === "boolean" ? search.revenueShare : undefined,
  }),
});
