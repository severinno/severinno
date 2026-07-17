"use client"

/**
 * Footer — enhanced marketplace footer with newsletter signup, dark mode support,
 * and improved visual design applying Nielsen's Heuristics.
 *
 * Heuristic mapping:
 *   H1  Visibility of system status  → Newsletter success/error states, current year, version
 *   H2  Match real world             → "Precisa de ajuda?" not "Suporte", "Para profissionais" not "Prestadores"
 *   H3  User control and freedom     → All links functional, back-to-top button, unsubscribe mention
 *   H4  Consistency                  → Same emerald accents, rounded buttons, link hover effects
 *   H5  Error prevention             → Email validation on newsletter, success/error toast
 *   H6  Recognition > recall         → Icons next to link groups, logo always visible, social icons
 *   H7  Flexibility/efficiency       → Quick access to most used links, newsletter in footer
 *   H8  Aesthetic minimalism         → Clean 4-column grid, organized hierarchy
 *   H9  Error recovery               → Handle newsletter gracefully, show confirmation
 *   H10 Help/documentation           → "Central de ajuda" prominent, contact info, FAQ link
 */

import * as React from "react"
import {
  MapPin,
  Github,
  Twitter,
  Instagram,
  Linkedin,
  Mail,
  Heart,
  ArrowUp,
  Send,
  CheckCircle2,
  HelpCircle,
  Users,
  Briefcase,
  MessageCircle,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/constants"
import { useViewStore, useUIStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FooterLink = {
  label: string
  onClick?: () => void
  href?: string
  icon?: React.ReactNode
}

type FooterColumn = {
  title: string
  icon: React.ReactNode
  links: FooterLink[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Footer({
  className,
}: {
  className?: string
}) {
  const navigate = useViewStore((s) => s.navigate)
  const openAuth = useUIStore((s) => s.openAuth)

  // Newsletter state — H1, H5, H9
  const [email, setEmail] = React.useState("")
  const [subscribed, setSubscribed] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const columns: FooterColumn[] = [
    {
      title: "Sobre",
      icon: <HelpCircle className="size-4" />,
      links: [
        { label: "Como funciona", onClick: () => navigate("vitrine") },
        { label: "Quem somos", onClick: () => navigate("vitrine") },
        { label: "Termos de uso", onClick: () => navigate("vitrine") },
        { label: "Privacidade", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Para profissionais",
      icon: <Briefcase className="size-4" />,
      links: [
        { label: "Cadastre-se", onClick: () => openAuth("register", "PROVIDER") },
        { label: "Meu painel", onClick: () => navigate("provider.dashboard") },
        { label: "Central de ajuda", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Precisa de ajuda?",
      icon: <MessageCircle className="size-4" />,
      links: [
        { label: "Perguntas frequentes", onClick: () => {
          const el = document.getElementById("faq")
          if (el) el.scrollIntoView({ behavior: "smooth" })
        }},
        { label: "Segurança", onClick: () => navigate("vitrine") },
        { label: "Reportar problema", onClick: () => navigate("vitrine") },
      ],
    },
  ]

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // H5: Error prevention — validate email
    const trimmed = email.trim()
    if (!trimmed) return
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmed)) {
      toast.error("E-mail inválido", {
        description: "Por favor, insira um e-mail válido.",
      })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error("Erro ao inscrever", {
          description: data.error || "Tente novamente mais tarde.",
        })
        return
      }

      setSubscribed(true)
      setEmail("")
      toast.success(
        data.alreadySubscribed ? "E-mail já inscrito!" : "Inscrição confirmada!",
        {
          description: data.alreadySubscribed
            ? "Você já receberá novidades e dicas no seu e-mail."
            : "Você receberá novidades e dicas no seu e-mail.",
        },
      )
    } catch {
      toast.error("Erro de conexão", {
        description: "Verifique sua internet e tente novamente.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const currentYear = new Date().getFullYear()

  return (
    <footer
      className={cn(
        "mt-auto w-full bg-slate-900 text-slate-300 dark:bg-slate-950",
        className,
      )}
    >
      {/* ─── Newsletter bar ─── */}
      <div className="border-b border-slate-800 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 dark:from-emerald-700 dark:via-emerald-800 dark:to-teal-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <div className="text-center sm:text-left">
            <p className="text-sm font-semibold text-white">
              Receba novidades e dicas de serviços
            </p>
            <p className="mt-0.5 text-xs text-emerald-100">
              Cadastre-se e receba ofertas exclusivas. Cancele quando quiser.
            </p>
          </div>
          {subscribed ? (
            // H1: Success state — visible confirmation
            <div className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2">
              <CheckCircle2 className="size-4 text-white" />
              <span className="text-sm font-medium text-white">
                Inscrito com sucesso!
              </span>
            </div>
          ) : (
            <form
              onSubmit={handleNewsletterSubmit}
              className="flex w-full max-w-sm items-center gap-2"
              noValidate
            >
              <div className="relative flex-1">
                <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-emerald-200" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Seu e-mail"
                  className="h-9 border-0 bg-white/20 pl-9 text-sm text-white placeholder:text-emerald-100 focus-visible:ring-white/40 dark:bg-white/10"
                  aria-label="E-mail para newsletter"
                  disabled={submitting}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !email.trim()}
                className="h-9 shrink-0 gap-1.5 bg-white px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                {submitting ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Assinar
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* ─── Main footer content ─── 4-column grid */}
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Column 1: Brand + Social */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
                <MapPin className="size-5" />
              </span>
              <span className="text-lg font-bold tracking-tight text-white">
                {APP_NAME}
              </span>
            </div>
            <p className="max-w-xs text-sm text-slate-400">
              Marketplace de serviços com geolocalização. Encontre prestadores
              verificados, próximos e bem avaliados.
            </p>
            <ul className="flex items-center gap-2" aria-label="Redes sociais">
              <SocialIcon icon={Github} label="GitHub" href="https://github.com" />
              <SocialIcon icon={Twitter} label="Twitter" href="https://twitter.com" />
              <SocialIcon icon={Instagram} label="Instagram" href="https://instagram.com" />
              <SocialIcon icon={Linkedin} label="LinkedIn" href="https://linkedin.com" />
              <SocialIcon icon={Mail} label="E-mail" href="mailto:contato@severinno.com" />
            </ul>
          </div>

          {/* Columns 2-4: Link groups */}
          {columns.map((col) => (
            <nav
              key={col.title}
              aria-label={col.title}
              className="space-y-3"
            >
              <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {col.icon}
                {col.title}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => {
                  const content = (
                    <span className="text-sm text-slate-400 transition-colors hover:text-white">
                      {link.label}
                    </span>
                  )
                  if (link.href) {
                    return (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="inline-block outline-none focus-visible:underline"
                        >
                          {content}
                        </a>
                      </li>
                    )
                  }
                  return (
                    <li key={link.label}>
                      <button
                        type="button"
                        onClick={link.onClick}
                        className="text-left outline-none focus-visible:underline"
                      >
                        {content}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          ))}

          {/* Column 4: Contact — H10 */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
              <Users className="size-4" />
              Contato
            </h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex items-center gap-2">
                <Mail className="size-3.5 shrink-0 text-slate-500" />
                <a
                  href="mailto:contato@severinno.com"
                  className="transition-colors hover:text-white"
                >
                  contato@severinno.com
                </a>
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="size-3.5 shrink-0 text-slate-500" />
                São Paulo, Brasil
              </li>
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5 border-slate-700 text-slate-300 hover:border-emerald-600 hover:text-emerald-400"
              onClick={() => {
                const el = document.getElementById("faq")
                if (el) el.scrollIntoView({ behavior: "smooth" })
              }}
            >
              <MessageCircle className="size-3.5" />
              Fale conosco
            </Button>
          </div>
        </div>

        {/* ─── Copyright bar ─── */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-800 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>
            © {currentYear} {APP_NAME} Marketplace. Todos os
            direitos reservados.
          </p>
          <p className="flex items-center gap-1 text-center sm:text-right">
            Feito com{" "}
            <Heart className="inline size-3 fill-rose-500 text-rose-500" />{" "}
            usando tecnologia Open Source (
            <a
              href="https://maplibre.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-slate-400 transition-colors hover:text-white hover:underline"
            >
              MapLibre
            </a>{" "}
            ·{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-slate-400 transition-colors hover:text-white hover:underline"
            >
              OpenStreetMap
            </a>
            )
          </p>
        </div>
      </div>

      {/* ─── Back-to-top button ─── H3: user control */}
      <BackToTopButton />
    </footer>
  )
}

// ---------------------------------------------------------------------------
// SocialIcon — H6: recognizable icons
// ---------------------------------------------------------------------------

function SocialIcon({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon
  label: string
  href: string
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
        className="flex size-9 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition-all hover:border-emerald-500 hover:text-emerald-400 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4" />
      </a>
    </li>
  )
}

// ---------------------------------------------------------------------------
// BackToTopButton — H3: user control and freedom
// ---------------------------------------------------------------------------

function BackToTopButton() {
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  if (!show) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-40 flex size-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 shadow-lg transition-all hover:border-emerald-500 hover:text-emerald-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-slate-950 dark:border-slate-700 sm:bottom-8 sm:right-8"
      aria-label="Voltar ao topo"
    >
      <ArrowUp className="size-4" />
    </button>
  )
}
