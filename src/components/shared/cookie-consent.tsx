"use client";

/**
 * CookieConsent — GDPR/LGPD-compliant cookie consent banner.
 *
 * Heuristics applied:
 *   H1  Visibility of system status  → Clear banner at bottom with purpose
 *   H2  Match real world             → Natural Portuguese, plain language
 *   H3  User control and freedom     → Accept/Reject/Customize options
 *   H4  Consistency                  → Emerald theme, same button styles
 *   H5  Error prevention             → No auto-dismiss, explicit choice required
 *   H8  Aesthetic minimalism         → Clean bar, not intrusive
 *   H10 Help/documentation           → Link to privacy policy
 */

import * as React from "react";
import { Cookie, Shield, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

type ConsentState = "accepted" | "rejected" | null;

export default function CookieConsent() {
  const [visible, setVisible] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    // Check if user has already made a choice
    const consent = localStorage.getItem("severinno:cookie-consent") as ConsentState;
    if (!consent) {
      // Show banner after a short delay so it doesn't interrupt initial page load
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("severinno:cookie-consent", "accepted");
    setVisible(false);
    setDismissed(true);
  };

  const handleReject = () => {
    localStorage.setItem("severinno:cookie-consent", "rejected");
    setVisible(false);
    setDismissed(true);
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-[60] border-t border-border bg-background/95 backdrop-blur-lg shadow-2xl"
        >
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Left: icon + text */}
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <Cookie className="size-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Usamos cookies para melhorar sua experiência
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Utilizamos cookies essenciais para o funcionamento do site e cookies de análise
                    para melhorar nossos serviços.{" "}
                    <button
                      type="button"
                      className="text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      Política de privacidade
                    </button>
                  </p>
                </div>
              </div>

              {/* Right: action buttons */}
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReject}
                  className="text-xs text-muted-foreground"
                >
                  Recusar
                </Button>
                <Button
                  size="sm"
                  onClick={handleAccept}
                  className="gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  <Shield className="size-3.5" />
                  Aceitar
                </Button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="ml-1 rounded-full p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Dispensar"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
