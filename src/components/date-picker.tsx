import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Native <input type="date"> can't be themed past its closed box — the
// expanded picker is OS-rendered. This reuses the same Calendar+Popover
// pattern already proven neo-brutal on the Executive Dashboard (see
// .exec-date-popover / .exec-period-input in styles.css) so every date
// filter in the app can look and behave the same way.
function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder = "Pilih tanggal",
  className = "",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const displayValue = selected?.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) ?? placeholder;

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="exec-period-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn("exec-period-input exec-date-trigger rounded-lg border border-border px-3 py-2 text-sm cursor-pointer", className)}>
            <span>{displayValue}</span><CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="exec-date-popover w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(dateKey(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
