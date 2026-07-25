"use client";

/**
 * CompareBar — sticky bottom bar shown when ≥1 provider is selected for
 * comparison. Mirrors the UX of e-commerce comparison features.
 *
 * Renders a slim, dismissible bar fixed to the bottom of the viewport
 * (only on the vitrine route). Clicking "Comparar" opens the CompareModal.
 */

import * as React from "react";
import { GitCompare, X, Trash2, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";
import { useCompareStore, MAX_COMPARE } from "@/store";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function CompareBar() {
  const ids = useCompareStore((s) => s.ids);
  const clear = useCompareStore((s) => s.clear);
  const remove = useCompareStore((s) => s.remove);
  const openCompare = useCompareStore((s) => s.openCompare);

  // Resolve names/avatars from the DOM via data-attributes on cards.
  // Each ProviderCard sets `data-compare-name` and `data-compare-avatar`
  // on the card root, so the bar can show provider chips without fetching.
  const [providerInfo, setProviderInfo] = React.useState<
    { id: string; name: string; avatarUrl?: string | null }[]
  >([]);

  React.useEffect(() => {
    if (ids.length === 0) {
      setProviderInfo([]);
      return;
    }
    const found: { id: string; name: string; avatarUrl?: string | null }[] = [];
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-provider-id="${id}"]`);
      if (el) {
        found.push({
          id,
          name: el.dataset.compareName || "Prestador",
          avatarUrl: el.dataset.compareAvatar || null,
        });
      } else {
        found.push({ id, name: "Prestador", avatarUrl: null });
      }
    }
    setProviderInfo(found);
  }, [ids]);

  const canCompare = ids.length >= 2;

  return (
    <AnimatePresence>
      {ids.length > 0 ? (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-5"
          aria-live="polite"
        >
          <div
            className={cn(
              "mx-auto flex max-w-5xl flex-col gap-3 rounded-2xl border border-emerald-200/70 bg-background/95 p-3 shadow-2xl backdrop-blur-md sm:flex-row sm:items-center sm:gap-4 sm:p-4",
              "dark:border-emerald-800/50",
            )}
          >
            {/* Left: icon + count */}
            <div className="flex items-center gap-2.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <GitCompare className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">Comparar prestadores</p>
                <p className="text-xs text-muted-foreground">
                  {ids.length} de {MAX_COMPARE} selecionado(s)
                  {!canCompare ? " · selecione mais 1" : ""}
                </p>
              </div>
            </div>

            {/* Middle: chips */}
            <div className="flex flex-1 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {providerInfo.map((p) => (
                <div
                  key={p.id}
                  className="group flex shrink-0 items-center gap-1.5 rounded-full border bg-muted/40 py-1 pr-1 pl-1.5"
                >
                  <Avatar className="size-6">
                    {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                    <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                      {p.name
                        .split(" ")
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[8rem] truncate text-xs font-medium">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={`Remover ${p.name} da comparação`}
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Right: actions */}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Limpar seleção"
              >
                <Trash2 className="size-4" />
                <span className="ml-1 hidden sm:inline">Limpar</span>
              </Button>
              <Button
                size="sm"
                onClick={openCompare}
                disabled={!canCompare}
                className="gap-2 rounded-full px-4"
              >
                Comparar
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
