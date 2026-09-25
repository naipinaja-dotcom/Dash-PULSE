// citiesFromRaw dulu shared sama fitur "Area City Pricing" (rate override
// per City lewat rail + modal) — fitur itu udah dipensiunkan (digantiin
// auto-breakdown District di delivery-fields.tsx, lihat area-rule-modal.tsx
// yang udah dihapus). Sisa satu-satunya pemakai fungsi ini adalah parser
// city_scope/hub_scope generik di pricing-form.tsx.
export function citiesFromRaw(raw: string): string[] {
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
