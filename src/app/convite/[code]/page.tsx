import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheck, Gift, Award, ArrowRight, CheckCircle2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card"
import { ConviteClientTracker } from "./convite-client-tracker"

interface ConvitePageProps {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: ConvitePageProps): Promise<Metadata> {
  const { code } = await params
  return {
    title: `Convite Especial ${code.toUpperCase()} — Severinno`,
    description:
      "Você recebeu um convite para o Severinno! Contrate prestadores de serviços qualificados com pagamento em custódia (Escrow) e garantia de satisfação.",
    openGraph: {
      title: `Convite Severinno: Código ${code.toUpperCase()}`,
      description: "Cadastre-se e aproveite benefícios exclusivos no seu primeiro agendamento.",
    },
  }
}

export default async function ConvitePage({ params }: ConvitePageProps) {
  const { code } = await params
  const cleanCode = code.toUpperCase().trim()

  return (
    <div className="from-background via-muted/30 to-background min-h-screen bg-gradient-to-b px-4 py-12 md:py-20">
      <ConviteClientTracker code={cleanCode} />

      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <div className="bg-primary/10 text-primary mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl shadow-sm">
            <Gift className="size-8" />
          </div>
          <span className="bg-primary/10 text-primary border-primary/20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase">
            Convite VIP de Indicação
          </span>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Você foi convidado para o <span className="text-primary">Severinno</span>!
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm sm:text-base">
            O marketplace de serviços mais confiável do Brasil. Use o código abaixo e garanta
            vantagens exclusivas.
          </p>
        </div>

        <Card className="border-primary/20 bg-card/90 shadow-lg backdrop-blur-sm">
          <CardHeader className="pb-2 text-center">
            <CardDescription className="text-xs font-semibold tracking-wider uppercase">
              Seu Código de Boas-Vindas
            </CardDescription>
            <div className="my-2 flex items-center justify-center">
              <span className="text-primary bg-primary/5 border-primary/40 rounded-xl border-2 border-dashed px-6 py-2.5 font-mono text-2xl font-black tracking-widest sm:text-3xl">
                {cleanCode}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Código ativo e pronto para ser aplicado no seu cadastro.
            </p>
          </CardHeader>

          <CardContent className="space-y-6 pt-4">
            <div className="bg-muted/40 space-y-3 rounded-lg p-4 text-sm">
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
                  <div className="text-foreground font-semibold">Profissionais Verificados</div>
                  <div className="text-muted-foreground text-xs">
                    Antecedentes checados, avaliações reais e geolocalização no mapa.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Award className="text-primary mt-0.5 size-5 shrink-0" />
                <div>
                  <div className="text-foreground font-semibold">Pontos no Clube de Fidelidade</div>
                  <div className="text-muted-foreground text-xs">
                    Acumule pontos em cada agendamento e troque por descontos futuros.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Button asChild size="lg" className="w-full gap-2 text-base font-semibold shadow-md">
                <Link href={`/register?ref=${cleanCode}`}>
                  Criar Minha Conta com Convite
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

        <div className="text-muted-foreground mt-8 flex items-center justify-center gap-4 text-center text-xs">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" /> Sem taxas ocultas
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-500" /> Cancelamento garantido
          </span>
        </div>
      </div>
    </div>
  )
}
