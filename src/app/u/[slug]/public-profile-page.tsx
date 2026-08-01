"use client"

import { Star, MapPin, Award } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = {
  provider: {
    id: string
    name: string
    bio: string | null
    avatarUrl: string | null
    coverUrl: string | null
    city: string | null
    state: string | null
    whatsapp: string | null
    rating: number
    reviewCount: number
    completedBookings: number
    services: Array<{
      id: string
      title: string
      basePrice: number
      duration: number | null
      description: string | null
    }>
    reviewsReceived: Array<{
      id: string
      rating: number
      comment: string | null
      createdAt: Date
      client: { name: string; avatarUrl: string | null }
    }>
    availability?: Array<{ dayOfWeek: number; startTime: string; endTime: string; active: boolean }>
  }
}

export function PublicProfilePage({ provider }: Props) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

  return (
    <div className="from-background to-muted/30 min-h-screen bg-gradient-to-b">
      <div className="from-primary/20 to-primary/10 h-48 bg-gradient-to-r md:h-64" />

      <div className="mx-auto max-w-4xl px-4">
        <div className="-mt-16 flex flex-col items-center gap-4 md:flex-row md:items-end md:gap-6">
          <Avatar className="border-background size-32 border-4 shadow-lg md:size-40">
            {provider.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="text-3xl font-bold">
              {provider.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 text-center md:text-left">
            <h1 className="text-2xl font-bold md:text-3xl">{provider.name}</h1>
            {provider.city && (
              <p className="text-muted-foreground flex items-center justify-center gap-1 text-sm md:justify-start">
                <MapPin className="size-3.5" />
                {provider.city}
                {provider.state ? `/${provider.state}` : ""}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 md:justify-start">
              {provider.rating > 0 && (
                <span className="inline-flex items-center gap-1 text-sm">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  {provider.rating.toFixed(1)} ({provider.reviewCount})
                </span>
              )}
              <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                <Award className="size-3.5" />
                {provider.completedBookings} serviço{provider.completedBookings !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {provider.bio && (
          <Card className="mt-6">
            <CardContent className="p-4">
              <p className="text-muted-foreground text-sm leading-relaxed">{provider.bio}</p>
            </CardContent>
          </Card>
        )}

        {provider.availability && provider.availability.length > 0 && (
          <Card className="mt-6">
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Horários de atendimento</h3>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {provider.availability
                  .filter((a) => a.active)
                  .map((a) => (
                    <div
                      key={a.dayOfWeek}
                      className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2"
                    >
                      <span className="text-sm font-medium">
                        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][a.dayOfWeek]}
                      </span>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {a.startTime.slice(0, 5)} — {a.endTime.slice(0, 5)}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {provider.services.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">Serviços</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {provider.services.map((svc) => (
                <Card key={svc.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">{svc.title}</h3>
                        {svc.description && (
                          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                            {svc.description}
                          </p>
                        )}
                        {svc.duration != null && (
                          <p className="text-muted-foreground mt-2 text-xs">{svc.duration} min</p>
                        )}
                      </div>
                      <p className="text-lg font-bold tabular-nums">{formatBRL(svc.basePrice)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 flex justify-center">
          <Button size="lg" asChild>
            <a
              href={`${appUrl}/?provider=${provider.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Agendar na plataforma
            </a>
          </Button>
        </div>

        {provider.reviewsReceived.length > 0 && (
          <section className="mt-8 pb-12">
            <h2 className="mb-4 text-lg font-semibold">Avaliações ({provider.reviewCount})</h2>
            <div className="grid gap-3">
              {provider.reviewsReceived.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="size-9">
                        {r.client.avatarUrl ? <AvatarImage src={r.client.avatarUrl} /> : null}
                        <AvatarFallback className="text-xs">
                          {r.client.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{r.client.name}</span>
                          <span className="inline-flex gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={cn(
                                  "size-3",
                                  i < r.rating
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/30",
                                )}
                              />
                            ))}
                          </span>
                        </div>
                        {r.comment && (
                          <p className="text-muted-foreground mt-1 text-sm">{r.comment}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="bg-background text-muted-foreground border-t py-4 text-center text-xs">
        <a href={appUrl} className="hover:text-foreground">
          Severinno
        </a>{" "}
        — Encontre profissionais perto de você
      </footer>
    </div>
  )
}
