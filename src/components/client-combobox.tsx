import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const MAX_VISIBLE = 10;

export function ClientCombobox({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Pilih client",
  className = "min-w-[180px]",
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return matches.slice(0, MAX_VISIBLE);
  }, [options, search]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "client-combobox-trigger flex items-center justify-between gap-2 rounded-md border-2 border-border-strong bg-card px-3 py-2 text-[12px] font-semibold outline-none focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="client-combobox-content w-[260px] p-0" align="start">
        <Command className="client-combobox-command" shouldFilter={false}>
          <CommandInput
            placeholder="Cari client..."
            value={search}
            onValueChange={setSearch}
            className="text-[12px]"
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="py-4 text-[12px] text-muted-foreground">
              Client tidak ditemukan
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onChange(o.value);
                    setSearch("");
                    setOpen(false);
                  }}
                  className="client-combobox-item text-[12px]"
                >
                  <Check className={cn("w-3.5 h-3.5", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {options.length > MAX_VISIBLE && filtered.length === MAX_VISIBLE && (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                Ketik buat cari yang lain — {options.length - MAX_VISIBLE} client lagi belum tampil.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
