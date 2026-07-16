"use client"

/**
 * Footer — sticky footer of the marketplace.
 *
 * Layout uses `mt-auto` so the footer is pushed to the bottom of the viewport
 * when content is shorter than one screen.
 *
 * Columns: Sobre, Categorias, Para prestadores, Suporte, Contato.
 * Bottom: © + Open Source credit + social icons (lucide).
 */

import * as React from "react"
import {
  MapPin,
  Github,
  Twitter,
  Instagram,
  Linkedin,
  Mail,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/constants"
import { useViewStore } from "@/store"

type Column = {
  title: string
  links: { label: string; onClick?: () => void; href?: string }[]
}

export default function Footer({
  className,
}: {
  className?: string
}) {
  const navigate = useViewStore((s) => s.navigate)

  const columns: Column[] = [
    {
      title: "Sobre",
      links: [
        { label: "Como funciona", onClick: () => navigate("vitrine") },
        { label: "Quem somos", onClick: () => navigate("vitrine") },
        { label: "Termos de uso", onClick: () => navigate("vitrine") },
        { label: "Privacidade", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Categorias",
      links: [
        { label: "Reparos", onClick: () => navigate("vitrine") },
        { label: "Limpeza", onClick: () => navigate("vitrine") },
        { label: "Reforma", onClick: () => navigate("vitrine") },
        { label: "Ver todas", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Para prestadores",
      links: [
        { label: "Cadastre-se", onClick: () => navigate("vitrine") },
        { label: "Meu painel", onClick: () => navigate("provider.dashboard") },
        { label: "Central de ajuda", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Suporte",
      links: [
        { label: "Ajuda e FAQ", onClick: () => navigate("vitrine") },
        { label: "Segurança", onClick: () => navigate("vitrine") },
        { label: "Reportar problema", onClick: () => navigate("vitrine") },
      ],
    },
    {
      title: "Contato",
      links: [
        { label: "contato@severinno.com", href: "mailto:contato@severinno.com" },
        { label: "São Paulo, Brasil", href: undefined },
      ],
    },
  ]

  return (
    <footer
      className={cn(
        "mt-auto w-full border-t border-slate-800 bg-slate-900 text-slate-300",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-6">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <MapPin className="size-5" />
              </span>
              <span className="text-lg font-bold tracking-tight text-white">
                {APP_NAME}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-slate-400">
              Marketplace de serviços com geolocalização. Encontre prestadores
              verificados, próximos e bem avaliados.
            </p>
            <ul className="mt-4 flex items-center gap-2">
              <SocialIcon icon={Github} label="GitHub" href="https://github.com" />
              <SocialIcon icon={Twitter} label="Twitter" href="https://twitter.com" />
              <SocialIcon icon={Instagram} label="Instagram" href="https://instagram.com" />
              <SocialIcon icon={Linkedin} label="LinkedIn" href="https://linkedin.com" />
              <SocialIcon icon={Mail} label="E-mail" href="mailto:contato@severinno.com" />
            </ul>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <nav
              key={col.title}
              aria-label={col.title}
              className="flex flex-col gap-2.5"
            >
              <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {col.title}
              </h3>
              {col.links.map((link) => {
                const content = (
                  <span className="text-sm text-slate-400 transition-colors hover:text-white">
                    {link.label}
                  </span>
                )
                if (link.href) {
                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      className="outline-none focus-visible:underline"
                    >
                      {content}
                    </a>
                  )
                }
                return (
                  <button
                    key={link.label}
                    type="button"
                    onClick={link.onClick}
                    className="text-left outline-none focus-visible:underline"
                  >
                    {content}
                  </button>
                )
              })}
            </nav>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-slate-800 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>
            © {new Date().getFullYear()} {APP_NAME} Marketplace. Todos os
            direitos reservados.
          </p>
          <p className="text-center sm:text-right">
            Feito com tecnologia Open Source (
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
    </footer>
  )
}

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
        className="flex size-8 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4" />
      </a>
    </li>
  )
}
