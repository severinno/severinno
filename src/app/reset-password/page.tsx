import { Suspense } from "react"
import Footer from "@/components/shared/footer"
import { ResetPasswordForm } from "./reset-password-form"

export const metadata = {
  title: "Redefinir senha — Severinno",
}

export default function Page() {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center p-4">
            <p className="text-muted-foreground">Carregando...</p>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
      <Footer />
    </>
  )
}
