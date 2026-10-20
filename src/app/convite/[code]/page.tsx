import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheck, Gift, Award, ArrowRight, CheckCircle2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card"
import { ConviteClientTracker } from "./convite-client-tracker"

interface ConvitePageProps {
  params: Promise<{ code: string }>
  searchParams?: Promise<{ tipo?: string }>
}

export async function generateMetadata({
  params,
  searchParams,
}: ConvitePageProps): Promise<Metadata> {
  const { code } = await params
  const { tipo } = (await searchParams) ?? {}
  const isProvider = tipo === "prestador" || tipo === "provider"

  return {
    title: isProvider
      ? `Convite Parceiro Especialista ${code.toUpperCase()} — Severinno GV`
      : `Convite Especial ${code.toUpperCase()} — Severinno GV`,
    description: isProvider
      ? "Venha ser um Prestador Parceiro Severinno em Governador Valadares. Zero mensalidade, pagamento garantido toda semana via custódia e demanda de clientes."
      : "Você recebeu um convite para o Severinno em Governador Valadares! Contrate prestadores qualificados com pagamento em custódia (Escrow) e garantia de satisfação.",
    openGraph: {
      title: isProvider
        ? `Convite Parceiro Especialista: Código ${code.toUpperCase()}`
        : `Convite Severinno: Código ${code.toUpperCase()}`,
      description: isProvider
        ? "Cadastre-se como prestador e acumule pontos no Clube de Benefícios no seu primeiro serviço."
        : "Cadastre-se e acumule pontos de boas-vindas no Clube de Benefícios no seu primeiro agendamento.",
    },
  }
}

export default async function ConvitePage({ params, searchParams }: ConvitePageProps) {
  const { code } = await params
  const { tipo } = (await searchParams) ?? {}
  const cleanCode = code.toUpperCase().trim()
  const isProvider = tipo === "prestador" || tipo === "provider"

  return (
    <div className="from-background via-muted/30 to-background min-h-screen bg-gradient-to-b px-4 py-12 md:py-20">
      <ConviteClientTracker code={cleanCode} intentType={isProvider ? "provider" : "client"} />

      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <div
            className={
              isProvider
                ? "mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 shadow-sm dark:text-amber-400"
                : "bg-primary/10 text-primary mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl shadow-sm"
            }
          >
            {isProvider ? <Award className="size-8" /> : <Gift className="size-8" />}
          </div>
          <span
            className={
              isProvider
                ? "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300"
                : "border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase"
            }
          >
            {isProvider ? "🎯 Convite Parceiro Especialista GV" : "🏠 Convite VIP de Indicação GV"}
          </span>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {isProvider ? (
              <>
                Seja um Prestador Parceiro{" "}
                <span className="text-amber-600 dark:text-amber-400">Severinno</span>
              </>
            ) : (
              <>
                Você foi convidado para o <span className="text-primary">Severinno</span>!
              </>
            )}
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm sm:text-base">
            {isProvider
              ? "O que sustenta a plataforma em Governador Valadares são especialistas que resolvem problemas reais. Entre para a rede oficial e conquiste clientes todos os dias."
              : "O marketplace de serviços mais confiável de Governador Valadares. Use o código abaixo e acumule pontos no Clube de Benefícios."}
          </p>
        </div>

        <Card
          className={
            isProvider
              ? "bg-card/90 border-amber-500/30 shadow-lg backdrop-blur-sm"
              : "border-primary/20 bg-card/90 shadow-lg backdrop-blur-sm"
          }
        >
          <CardHeader className="pb-2 text-center">
            <CardDescription className="text-xs font-semibold tracking-wider uppercase">
              {isProvider ? "Seu Código de Acesso Especialista" : "Seu Código de Boas-Vindas"}
            </CardDescription>
            <div className="my-2 flex items-center justify-center">
              <span
                className={
                  isProvider
                    ? "rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 px-6 py-2.5 font-mono text-2xl font-black tracking-widest text-amber-600 sm:text-3xl dark:text-amber-400"
                    : "border-primary/40 bg-primary/5 text-primary rounded-xl border-2 border-dashed px-6 py-2.5 font-mono text-2xl font-black tracking-widest sm:text-3xl"
                }
              >
                {cleanCode}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {isProvider
                ? "Código prioritário para aprovação cadastral e pontuação no Clube de Benefícios."
                : "Código ativo e pronto para ser aplicado no seu cadastro."}
            </p>
          </CardHeader>

          <CardContent className="space-y-6 pt-4">
            <div className="bg-muted/40 space-y-3 rounded-lg p-4 text-sm">
              {isProvider ? (
                <>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                    <div>
                      <div className="text-foreground font-semibold">
                        Pagamento Garantido em Custódia (Escrow)
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Sem calote ou atrasos. O valor do cliente fica retido e liberado com
                        segurança na conclusão do serviço.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Star className="mt-0.5 size-5 shrink-0 text-amber-500" />
                    <div>
                      <div className="text-foreground font-semibold">
                        Demanda Diária em Governador Valadares
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Clientes em bairros como Ilha dos Araújos, Centro, Vila Isa e toda GV
                        buscando serviços diariamente.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Award className="text-primary mt-0.5 size-5 shrink-0" />
                    <div>
                      <div className="text-foreground font-semibold">
                        +50 Pontos de Boas-Vindas no Clube
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Pontos creditados no seu 1º serviço para futura conversão em vantagens
                        operacionais e visibilidade VIP no radar (não dinheiro).
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                    <div>
                      <div className="text-foreground font-semibold">
                        Pagamento 100% Protegido (Escrow)
                      </div>
                      <div className="text-muted-foreground text-xs">
                        O prestador só recebe após o serviço concluído e aprovado por você.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Star className="mt-0.5 size-5 shrink-0 text-amber-500" />
                    <div>
                      <div className="text-foreground font-semibold">
                        Profissionais Verificados em GV
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Antecedentes checados, avaliações reais e geolocalização no mapa de
                        Governador Valadares.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Award className="text-primary mt-0.5 size-5 shrink-0" />
                    <div>
                      <div className="text-foreground font-semibold">
                        +25 Pontos de Boas-Vindas no Clube
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Acumule pontos em cada agendamento no Clube de Benefícios para futura
                        conversão em descontos (não dinheiro).
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Button
                asChild
                size="lg"
                className={
                  isProvider
                    ? "w-full gap-2 bg-amber-600 text-base font-semibold text-white shadow-md hover:bg-amber-700"
                    : "w-full gap-2 text-base font-semibold shadow-md"
                }
              >
                <Link
                  href={
                    isProvider
                      ? `/register?ref=${cleanCode}&role=provider`
                      : `/register?ref=${cleanCode}&role=client`
                  }
                >
                  {isProvider
                    ? "Cadastrar como Prestador Parceiro"
                    : "Criar Minha Conta e Contratar"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                size="sm"
                className="text-muted-foreground w-full text-xs"
              >
                <Link href={`/login?ref=${cleanCode}`}>Já possui conta? Fazer Login</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="text-muted-foreground mt-8 flex flex-wrap items-center justify-center gap-4 text-center text-xs">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" /> Sem mensalidade
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" /> Cancelamento garantido
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" /> Pontos no Clube de Benefícios
          </span>
        </div>
      </div>
    </div>
  )
}
