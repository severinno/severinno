"use client";

/**
 * FlowTimeline — "what happens now" transparency for quotes and bookings.
 *
 * Nielsen heuristics:
 *   H1  Visibilidade do status → current step highlighted + progress
 *   H10 Ajuda e documentação  → explains the process so users know what to expect
 *
 * Trust/Transparency: users trust a platform that explains its process clearly.
 * Reduces anxiety after sending a quote or booking a service.
 */

import * as React from "react";
import { CheckCircle2, Clock, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineStep = {
  label: string;
  description: string;
  status: "done" | "current" | "upcoming";
};

export type FlowTimelineProps = {
  steps: TimelineStep[];
  className?: string;
};

export function FlowTimeline({ steps, className }: FlowTimelineProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
          <Clock className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">O que acontece agora</h3>
          <p className="text-xs text-muted-foreground">Acompanhe cada etapa em tempo real</p>
        </div>
      </div>

      {/* Steps */}
      <ol className="relative space-y-4">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const Icon =
            step.status === "done" ? CheckCircle2 : step.status === "current" ? Clock : Circle;
          return (
            <li key={i} className="relative flex gap-3">
              {/* Connector line */}
              {!isLast && (
                <span
                  className={cn(
                    "absolute top-7 left-3.5 h-full w-0.5",
                    step.status === "done"
                      ? "bg-emerald-300 dark:bg-emerald-700"
                      : "bg-slate-200 dark:bg-slate-800",
                  )}
                />
              )}
              {/* Icon */}
              <span
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full",
                  step.status === "done" &&
                    "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400",
                  step.status === "current" &&
                    "bg-emerald-600 text-white ring-4 ring-emerald-600/20",
                  step.status === "upcoming" && "bg-slate-100 text-slate-400 dark:bg-slate-800",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {/* Content */}
              <div className={cn("flex-1 pb-1", step.status === "upcoming" && "opacity-60")}>
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.status === "current" && "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {step.label}
                  {step.status === "current" && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                      AGORA
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-built timelines for quotes and bookings
// ---------------------------------------------------------------------------

export function QuoteTimeline({ status }: { status: string }) {
  const steps: TimelineStep[] = [
    {
      label: "Orçamento enviado",
      description: "O prestador recebeu sua solicitação",
      status:
        status === "PENDING" ||
        status === "RESPONDED" ||
        status === "APPROVED" ||
        status === "REJECTED"
          ? "done"
          : "upcoming",
    },
    {
      label: "Prestador responde",
      description: "Você recebe o preço e detalhes do serviço",
      status:
        status === "RESPONDED" || status === "APPROVED" || status === "REJECTED"
          ? "done"
          : status === "PENDING"
            ? "current"
            : "upcoming",
    },
    {
      label: "Você aprova ou rejeita",
      description: "Compare e escolha o melhor orçamento",
      status:
        status === "APPROVED" || status === "REJECTED"
          ? "done"
          : status === "RESPONDED"
            ? "current"
            : "upcoming",
    },
    {
      label: "Agende o serviço",
      description: "Escolha data e horário com o prestador aprovado",
      status: status === "APPROVED" ? "current" : "upcoming",
    },
  ];
  return <FlowTimeline steps={steps} />;
}

export function BookingTimeline({ status }: { status: string }) {
  const steps: TimelineStep[] = [
    {
      label: "Agendamento solicitado",
      description: "Pagamento reservado com segurança",
      status:
        status === "PENDING" ||
        status === "CONFIRMED" ||
        status === "IN_PROGRESS" ||
        status === "COMPLETED"
          ? "done"
          : "upcoming",
    },
    {
      label: "Prestador confirma",
      description: "Confirmação do horário com o profissional",
      status:
        status === "CONFIRMED" || status === "IN_PROGRESS" || status === "COMPLETED"
          ? "done"
          : status === "PENDING"
            ? "current"
            : "upcoming",
    },
    {
      label: "Serviço em andamento",
      description: "O prestador está realizando o serviço",
      status:
        status === "IN_PROGRESS" || status === "COMPLETED"
          ? "done"
          : status === "CONFIRMED"
            ? "current"
            : "upcoming",
    },
    {
      label: "Serviço concluído",
      description: "Você marca como concluído e avalia — pagamento é liberado",
      status: status === "COMPLETED" ? "done" : "upcoming",
    },
  ];
  return <FlowTimeline steps={steps} />;
}
