import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"

// Estado de auth parametrizável — os testes de boas-vindas/foto injetam o
// usuário do cadastro (nome, cidade/estado, avatarUrl) antes do render.
const mockAuthState: { user: Record<string, unknown> | null; setUser: ReturnType<typeof vi.fn> } = {
  user: null,
  setUser: vi.fn(),
}

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => (selector ? selector(mockAuthState) : mockAuthState)),
}))

// jsdom não implementa URL.createObjectURL — polyfill mínimo para a prévia.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn(() => "blob:mock-preview")
  URL.revokeObjectURL = vi.fn()
}

const mockMutateAsync = vi.fn().mockResolvedValue({})

const { CATEGORIES_TREE } = vi.hoisted(() => ({
  CATEGORIES_TREE: [
    {
      id: "r1",
      name: "Elétrica",
      level: 0,
      children: [
        {
          id: "m1",
          name: "Instalações",
          level: 1,
          children: [{ id: "cat-1", name: "Tomadas", level: 2, children: [] }],
        },
      ],
    },
  ],
}))

// O passo Endereço embute o mapa de raio (maplibre → WebGL, indisponível no
// jsdom) — mock leve, sem afetar os demais componentes.
vi.mock("@/components/shared/radius-preview-map", () => ({
  default: (p: { initialRadius?: number; accuracyM?: number | null }) => (
    <div
      data-testid="radius-map-mock"
      data-initial-radius={String(p?.initialRadius ?? "")}
      data-accuracy={p?.accuracyM == null ? "" : String(p.accuracyM)}
    />
  ),
}))

vi.mock("@tanstack/react-query", () => ({
  // Responde por queryKey: a wizard busca progresso e categorias; o select do
  // passo Serviços precisa das subcategorias reais (senão o change vira "").
  useQuery: vi.fn((options?: { queryKey?: unknown[] }) => {
    if (options?.queryKey?.[0] === "onboarding-categories") {
      return { data: CATEGORIES_TREE, isLoading: false, isSuccess: true }
    }
    return { data: undefined, isLoading: false, isSuccess: true }
  }),
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}))

vi.mock("lucide-react", () => ({
  Camera: () => <svg />,
  Check: () => <svg />,
  ChevronLeft: () => <svg />,
  ChevronRight: () => <svg />,
  ImagePlus: () => <svg />,
  Loader2: () => <svg />,
  LocateFixed: () => <svg />,
  MapPin: () => <svg />,
  Navigation: () => <svg />,
  Play: () => <svg />,
  Smartphone: () => <svg />,
  Volume2: () => <svg />,
  X: () => <svg />,
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/lib/api", () => ({
  apiPatch: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiGet: vi.fn().mockResolvedValue({}),
  fetchCep: vi.fn().mockResolvedValue({}),
  fetchReverseGeo: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/client-cep-cache", () => ({
  getCachedCep: vi.fn(() => null),
  setCachedCep: vi.fn(),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  tryVibrate: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

afterEach(cleanup)

describe("ProviderOnboarding", () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.user = null
  })

  it("renders the first step with the progress indicator", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Complete seu perfil")).toBeDefined()
    expect(screen.getByText(/Passo 1 de 4/)).toBeDefined()
  })

  it("renders profile form fields on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Nome")).toBeDefined()
    expect(screen.getByText("Bio")).toBeDefined()
    expect(screen.getByText("WhatsApp")).toBeDefined()
  })

  it("has próximo button and voltar disabled on first step", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Próximo")).toBeDefined()
    const voltar = screen.getByText("Voltar")
    expect(voltar.closest("button")).toBeDisabled()
  })

  it("renders address step after clicking próximo", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))

    expect(await screen.findByText("Onde você atende?")).toBeDefined()
    expect(screen.getByText("Cidade")).toBeDefined()
    expect(screen.getByText("Estado")).toBeDefined()
  })

  it("blocks próximo with inline error when name is too short", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByText("Próximo"))

    expect(screen.getByRole("alert")).toBeDefined()
    expect(screen.queryByText("Onde você atende?")).not.toBeInTheDocument()
  })

  it("allows going back from step 1 to step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    fireEvent.click(screen.getByText("Voltar"))
    expect(await screen.findByText("Complete seu perfil")).toBeDefined()
  })

  // ── Sound & vibration preference toggles ─────────────────────────────────

  it("renders sound preference toggle on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration preference toggle on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
  })

  it("includes soundEnabled and vibrateEnabled when clicking Próximo", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    // Fill required fields
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.change(screen.getByPlaceholderText("Conte um pouco sobre você..."), {
      target: { value: "Sou um profissional." },
    })

    fireEvent.click(screen.getByText("Próximo"))

    // Should advance to next step
    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    // mutateAsync should have been called with soundEnabled and vibrateEnabled
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        soundEnabled: true,
        vibrateEnabled: true,
      }),
    )
  })

  it("toggling sound off reflects in mutation call", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    // Toggle sound OFF
    const soundSwitch = screen.getByLabelText("Ativar sons do painel")
    fireEvent.click(soundSwitch)

    // Fill required fields
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.change(screen.getByPlaceholderText("Conte um pouco sobre você..."), {
      target: { value: "Sou um profissional." },
    })

    fireEvent.click(screen.getByText("Próximo"))

    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        soundEnabled: false,
        vibrateEnabled: true,
      }),
    )
  })
})

describe("ProviderOnboarding — passo final (serviço, nada silencioso)", () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.user = null
  })

  async function goToServiceStep() {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByLabelText("Cidade")
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Governador Valadares" } })
    fireEvent.click(screen.getByText("Próximo"))
    // Horários: default já tem Seg-Sex ativos
    await screen.findByText("Seus horários")
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByText("Seu primeiro serviço")
  }

  function fillServiceStep() {
    fireEvent.change(screen.getByLabelText("Nome do serviço"), {
      target: { value: "Troca de tomada" },
    })
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Troca de tomadas e interruptores com garantia." },
    })
    fireEvent.change(screen.getByLabelText("Subcategoria"), { target: { value: "cat-1" } })
    fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "80" } })
  }

  it("publica o serviço com o payload COMPLETO do schema e conclui o onboarding", async () => {
    const { apiPost, apiPatch } = await import("@/lib/api")
    const post = apiPost as unknown as ReturnType<typeof vi.fn>
    const patch = apiPatch as unknown as ReturnType<typeof vi.fn>
    post.mockResolvedValue({})
    patch.mockResolvedValue({})

    await goToServiceStep()
    fillServiceStep()
    fireEvent.click(screen.getByText("Publicar meu serviço"))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    expect(post).toHaveBeenCalledWith(
      "/api/services",
      expect.objectContaining({
        title: "Troca de tomada",
        description: "Troca de tomadas e interruptores com garantia.",
        categoryId: "cat-1",
        basePrice: 80,
        unit: "UNIDADE",
        photos: [],
        active: true,
      }),
    )
    expect(post).toHaveBeenCalledWith(
      "/api/availability",
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            dayOfWeek: 0,
            startTime: "08:00",
            endTime: "18:00",
            active: true,
          }),
        ]),
      }),
    )
    expect(patch).toHaveBeenCalledWith("/api/provider/onboarding", { step: 4, done: true })
  })

  it("serviço que falha NÃO conclui o onboarding — erro visível, done não marcado", async () => {
    const { apiPost, apiPatch } = await import("@/lib/api")
    const { toast } = await import("sonner")
    const post = apiPost as unknown as ReturnType<typeof vi.fn>
    const patch = apiPatch as unknown as ReturnType<typeof vi.fn>
    post.mockImplementation((path: string) =>
      path === "/api/services"
        ? Promise.reject({ status: 400, message: "Selecione uma subcategoria" })
        : Promise.resolve({}),
    )
    patch.mockResolvedValue({})

    await goToServiceStep()
    fillServiceStep()
    fireEvent.click(screen.getByText("Publicar meu serviço"))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Selecione uma subcategoria"))
    expect(patch).not.toHaveBeenCalledWith("/api/provider/onboarding", { step: 4, done: true })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("valida o passo Serviços inline (descrição curta bloqueia a publicação)", async () => {
    await goToServiceStep()
    fireEvent.change(screen.getByLabelText("Nome do serviço"), {
      target: { value: "Troca de tomada" },
    })
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "curta" } })
    fireEvent.click(screen.getByText("Publicar meu serviço"))

    expect(screen.getByRole("alert")).toBeDefined()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("passo final mostra resumo do perfil (iniciais, nome, cidade) e progresso completo", async () => {
    await goToServiceStep()

    expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    expect(screen.getByText("Governador Valadares")).toBeInTheDocument()
    expect(screen.getByText("CS")).toBeInTheDocument()
    expect(screen.getByText(/Confira tudo antes de publicar/)).toBeInTheDocument()

    const progress = screen.getByRole("progressbar")
    expect(progress.getAttribute("aria-valuenow")).toBe("4")
    expect(progress.getAttribute("aria-label")).toMatch(/Etapa 4 de 4: Serviços/)
  })

  it("segmentos concluídos do stepper são botões que voltam direto à etapa", async () => {
    await goToServiceStep()

    // 3 etapas anteriores concluídas → 3 botões "Voltar para a etapa"
    const backButtons = screen.getAllByRole("button", { name: /Voltar para a etapa/ })
    expect(backButtons.length).toBe(3)
    expect(screen.getByRole("button", { name: /Voltar para a etapa 1: Perfil/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Voltar para a etapa 3: Horários/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Voltar para a etapa 1: Perfil/ }))
    await screen.findByLabelText("Nome")
    expect(screen.getByText(/Passo 1 de 4/)).toBeTruthy()

    // E o segmento da etapa atual não é clicável (não há botão para "Etapa 1" já nela)
    expect(screen.queryByRole("button", { name: /Voltar para a etapa 1: Perfil/ })).toBeNull()
  })

  it("etapas visitadas à frente do atual ganham borda tracejada; wizard fresco não marca nada", async () => {
    // Wizard fresco (passo Perfil): nada visitado além do atual
    const { ProviderOnboarding } = await import("../provider-onboarding")
    const first = render(<ProviderOnboarding onComplete={onComplete} />)
    expect(first.container.querySelectorAll('[data-visited="true"]')).toHaveLength(0)
    first.unmount()

    // Avança até o último passo (todas as etapas ficam visitadas) e volta ao Perfil
    await goToServiceStep()
    fireEvent.click(screen.getByRole("button", { name: /Voltar para a etapa 1: Perfil/ }))
    await screen.findByLabelText("Nome")

    // Endereço, Horários e Serviços foram visitados e estão à frente → tracejado
    const visited = [...document.querySelectorAll('[data-visited="true"]')]
    expect(visited.map((el) => el.getAttribute("data-step-index"))).toEqual(["1", "2", "3"])
    for (const el of visited) {
      expect(el.className).toContain("border-dashed")
      expect(el.getAttribute("title")).toMatch(/já visitou/)
    }
    // Etapa atual (Perfil) não é marcada como visitada
    const current = document.querySelector('[data-step-index="0"]')
    expect(current?.getAttribute("data-visited")).toBeNull()
  })
})

describe("ProviderOnboarding — boas-vindas e foto de perfil", () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.user = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("dá boas-vindas pelo primeiro nome e mostra cidade/estado do cadastro", async () => {
    mockAuthState.user = {
      id: "u1",
      name: "Carlos Encanador",
      email: "carlos@x.com",
      role: "PROVIDER",
      city: "Governador Valadares",
      state: "MG",
    }
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText(/Olá, Carlos!/)).toBeDefined()
    expect(screen.getByText("Governador Valadares — MG")).toBeDefined()
    // sem nome no cadastro, o título genérico é mantido
    expect(screen.queryByText("Complete seu perfil")).not.toBeInTheDocument()
  })

  it("sem nome, mantém o título genérico; sem cidade, convida a completar o Endereço", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText("Complete seu perfil")).toBeDefined()
    expect(screen.getByText(/Sua cidade aparece aqui/)).toBeDefined()
  })

  it("renderiza os controles de foto (anexar, tirar e input oculto)", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText(/Anexar foto/)).toBeDefined()
    expect(screen.getByText(/Tirar foto/)).toBeDefined()
    expect(screen.getByLabelText("Anexar foto de perfil")).toBeDefined()
    expect(screen.getByText(/JPG, PNG ou WebP/)).toBeDefined()
  })

  it("upload bem-sucedido alimenta o preview e o updateProfile leva avatarUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://cdn.severinno.com/avatar.jpg" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    const input = screen.getByLabelText("Anexar foto de perfil") as HTMLInputElement
    const file = new File(["fake-image-bytes"], "eu.jpg", { type: "image/jpeg" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByAltText("Prévia da foto de perfil")).toBeDefined()

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByText("Onde você atende?")

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarUrl: "https://cdn.severinno.com/avatar.jpg",
        name: "Carlos Silva",
      }),
    )
  })

  it("falha de upload não persiste nada — prévia some e avatarUrl não vai no PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Tipo de arquivo não permitido" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const { toast } = await import("sonner")

    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    const input = screen.getByLabelText("Anexar foto de perfil") as HTMLInputElement
    const file = new File(["fake"], "malware.exe", { type: "application/octet-stream" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tipo de arquivo não permitido"))
    expect(screen.queryByAltText("Prévia da foto de perfil")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByText("Onde você atende?")

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.not.objectContaining({ avatarUrl: expect.anything() }),
    )
  })

  it("câmera indisponível mostra erro acionável e o overlay fecha sem quebrar", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByText(/Tirar foto/))

    const dialog = await screen.findByRole("dialog", { name: /câmera/i })
    expect(dialog).toBeDefined()
    expect(await screen.findByText(/Não foi possível acessar a câmera/)).toBeDefined()

    fireEvent.click(screen.getByText("Cancelar"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

describe("ProviderOnboarding — passo Endereço: CEP e GPS (nada manual se evitável)", () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.user = null
  })

  async function goToAddressStep() {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByText("Onde você atende?")
  }

  it("CEP completo preenche rua/cidade/estado automaticamente (ViaCEP)", async () => {
    const { fetchCep } = await import("@/lib/api")
    const cep = fetchCep as unknown as ReturnType<typeof vi.fn>
    cep.mockResolvedValue({
      cep: "35010-300",
      street: "Rua Benedito Valadares",
      city: "Governador Valadares",
      state: "MG",
    })

    await goToAddressStep()

    const input = screen.getByLabelText("CEP")
    fireEvent.change(input, { target: { value: "35010300" } })

    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("Governador Valadares"))
    expect(screen.getByLabelText("Estado")).toHaveValue("MG")
    expect(screen.getByLabelText("Rua")).toHaveValue("Rua Benedito Valadares")
    expect(screen.getByLabelText("CEP")).toHaveValue("35010-300")
  })

  it("CEP com máscara parcial não chama a API; CEP inexistente mostra erro acionável", async () => {
    const { fetchCep } = await import("@/lib/api")
    const cep = fetchCep as unknown as ReturnType<typeof vi.fn>
    cep.mockRejectedValue(new Error("not_found"))

    await goToAddressStep()

    const input = screen.getByLabelText("CEP")
    fireEvent.change(input, { target: { value: "3501" } })
    expect(cep).not.toHaveBeenCalled()
    expect(screen.getByLabelText("CEP")).toHaveValue("3501")

    fireEvent.change(input, { target: { value: "35010" } })
    expect(screen.getByLabelText("CEP")).toHaveValue("35010")

    fireEvent.change(input, { target: { value: "00000000" } })
    await screen.findByRole("alert")
    expect(screen.getByRole("alert").textContent).toMatch(/CEP não encontrado/)
    // Campos permanecem editáveis para correção manual
    expect(screen.getByLabelText("Cidade")).toBeEnabled()
  })

  it("resultado em cache (localStorage) preenche sem chamar a API", async () => {
    const { getCachedCep } = await import("@/lib/client-cep-cache")
    const { fetchCep } = await import("@/lib/api")
    const cache = getCachedCep as unknown as ReturnType<typeof vi.fn>
    const cep = fetchCep as unknown as ReturnType<typeof vi.fn>
    cache.mockReturnValue({
      cep: "35010-300",
      street: "Rua Cache",
      city: "Governador Valadares",
      state: "MG",
    })

    await goToAddressStep()

    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "35010300" } })

    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("Governador Valadares"))
    expect(cep).not.toHaveBeenCalled()
  })

  it("GPS: preenche endereço pelo reverse geocode e salva lat/lng no Próximo", async () => {
    const { fetchReverseGeo } = await import("@/lib/api")
    const rev = fetchReverseGeo as unknown as ReturnType<typeof vi.fn>
    rev.mockResolvedValue({
      street: "Av. Florestal",
      city: "Governador Valadares",
      state: "MG",
      cep: "35010-580",
    })

    const coords = { latitude: -18.8517, longitude: -41.9469, accuracy: 12 }
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) => success({ coords }))
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    const { apiPatch } = await import("@/lib/api")
    const patch = apiPatch as unknown as ReturnType<typeof vi.fn>
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carlos Silva" } })
    fireEvent.click(screen.getByText("Próximo"))
    await screen.findByText("Onde você atende?")

    fireEvent.click(screen.getByText("Usar GPS do celular"))

    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("Governador Valadares"))
    expect(screen.getByLabelText("Estado")).toHaveValue("MG")
    expect(screen.getByLabelText("CEP")).toHaveValue("35010-580")
    expect(screen.getByText(/Endereço preenchido pelo GPS/)).toBeDefined()
    // accuracy 12 m (GPS excelente) → raio inicial sugerido: 5 km
    expect(screen.getByText(/Raio inicial sugerido: 5 km/)).toBeDefined()
    expect(screen.getByTestId("radius-map-mock").getAttribute("data-initial-radius")).toBe("5")
    // accuracy flui para o mapa → círculo pontilhado de incerteza
    expect(screen.getByTestId("radius-map-mock").getAttribute("data-accuracy")).toBe("12")

    fireEvent.click(screen.getByText("Próximo"))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        "/api/provider/onboarding",
        expect.objectContaining({ step: 2 }),
      ),
    )
    // accuracy da fix persiste no perfil (updateProfile → PATCH /api/users/me)
    // — o círculo de incerteza reaparece depois com a localização salva
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: -18.8517,
        lng: -41.9469,
        radiusKm: 5,
        gpsAccuracyM: 12,
      }),
    )
  })

  it("GPS negado mostra orientação amigável sem quebrar o passo", async () => {
    const getCurrentPosition = vi.fn(
      (_s: unknown, fail: (e: { code: number; PERMISSION_DENIED: number }) => void) =>
        fail({ code: 1, PERMISSION_DENIED: 1 }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    await goToAddressStep()
    fireEvent.click(screen.getByText("Usar GPS do celular"))

    await screen.findByText(/Permissão de localização negada/)
    // Fluxo manual segue funcionando
    expect(screen.getByLabelText("Cidade")).toBeEnabled()
  })
})
