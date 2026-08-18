/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor, cleanup } from "@/__tests__/test-utils"
import { FilePhotos } from "../file-photos"

// ---------------------------------------------------------------------------
// Mock UI dependencies
// ---------------------------------------------------------------------------

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

vi.mock("lucide-react", () => {
  const Icon = () => <span data-testid="icon" />
  Icon.displayName = "Icon"
  return {
    Loader2: () => <span data-testid="icon-loading" />,
    UploadCloud: () => <span data-testid="icon-upload" />,
    X: () => <span data-testid="icon-x" />,
  }
})

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let mockResponse: { ok: boolean; url?: string; status?: number } = {
  ok: true,
  url: "https://example.com/photo.jpg",
}
let createObjectURLSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockResponse = { ok: true, url: "https://example.com/photo.jpg" }

  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: mockResponse.ok,
        status: mockResponse.status ?? 200,
        json: () => Promise.resolve(mockResponse.ok ? { url: mockResponse.url } : null),
      }),
    ),
  )

  createObjectURLSpy = vi.fn((_file: File) => "blob:local-preview")
  vi.stubGlobal("URL", { createObjectURL: createObjectURLSpy })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFile(name: string, type = "image/jpeg", size = 1024 * 1024): File {
  return new File([new ArrayBuffer(size)], name, { type })
}

function createNonImageFile(): File {
  return new File(["not-an-image"], "document.pdf", { type: "application/pdf" })
}

function createOversizedFile(): File {
  return new File([new ArrayBuffer(6 * 1024 * 1024)], "large.jpg", { type: "image/jpeg" })
}

function findFileInput(root: HTMLElement): HTMLInputElement {
  return root.querySelector('input[type="file"]') as HTMLInputElement
}

function renderPhotos(props: Partial<Parameters<typeof FilePhotos>[0]> = {}) {
  const onChange = vi.fn()
  const result = render(<FilePhotos value={[]} onChange={onChange} {...props} />)
  return { onChange, result }
}

// =========================================================================
// Tests
// =========================================================================

describe("FilePhotos — rendering", () => {
  it("renders drop zone when max > value.length", () => {
    renderPhotos()
    expect(screen.getByText("Arraste imagens ou clique para enviar")).toBeInTheDocument()
  })

  it("renders with label", () => {
    renderPhotos({ label: "Fotos do serviço" })
    expect(screen.getByText("Fotos do serviço")).toBeInTheDocument()
  })

  it("renders with hint", () => {
    renderPhotos({ hint: "Máximo 4 fotos" })
    expect(screen.getByText("Máximo 4 fotos")).toBeInTheDocument()
  })

  it("shows counter with value.length/max", () => {
    renderPhotos({ value: ["url1"], max: 4 })
    const counters = screen.getAllByText("1/4 fotos")
    expect(counters.length).toBeGreaterThan(0)
  })

  it("hides drop zone when max reached", () => {
    renderPhotos({ value: ["url1", "url2", "url3", "url4"], max: 4 })
    expect(screen.queryByText("Arraste imagens ou clique para enviar")).not.toBeInTheDocument()
  })

  it("renders preview grid with photos", () => {
    const urls = ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"]
    renderPhotos({ value: urls })

    const images = screen.getAllByRole("img")
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute("src", urls[0])
    expect(images[1]).toHaveAttribute("src", urls[1])
  })

  it("renders remove buttons for each photo", () => {
    const urls = ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"]
    renderPhotos({ value: urls })

    const removeBtns = screen.getAllByLabelText(/Remover foto/)
    expect(removeBtns).toHaveLength(2)
  })

  it("does not render img tags when value is empty", () => {
    const { result } = renderPhotos()
    expect(result.container.querySelector("img")).not.toBeInTheDocument()
    expect(screen.getByText("Arraste imagens ou clique para enviar")).toBeInTheDocument()
  })

  it("does not render counter when label is empty string", () => {
    renderPhotos({ label: "" })
    // The counter is inside the label div which is conditionally rendered
    // When label is falsy, the whole div is hidden
    expect(screen.queryAllByText("0/4 fotos").length).toBe(0)
  })
})

describe("FilePhotos — upload flow", () => {
  it("has a hidden file input", () => {
    const { result } = renderPhotos()
    const input = findFileInput(result.container)
    expect(input).toBeInTheDocument()
    expect(input.type).toBe("file")
    expect(input.multiple).toBe(true)
  })

  it("uploads files via fetch to /api/upload", async () => {
    const { onChange, result } = renderPhotos()
    const input = findFileInput(result.container)
    const file = createMockFile("photo.jpg")

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    )
    expect(onChange).toHaveBeenCalledWith(["https://example.com/photo.jpg"])
  })

  it("uploads multiple files at once", async () => {
    const { onChange, result } = renderPhotos({ max: 5 })
    const input = findFileInput(result.container)
    const files = [createMockFile("a.jpg"), createMockFile("b.jpg")]

    await act(async () => {
      fireEvent.change(input, { target: { files } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalled()
  })

  it("falls back to local object URL when upload fails", async () => {
    mockResponse = { ok: false, status: 500 }

    const { onChange, result } = renderPhotos()
    const input = findFileInput(result.container)
    const file = createMockFile("photo.jpg")

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(createObjectURLSpy).toHaveBeenCalledWith(file)
    expect(onChange).toHaveBeenCalledWith(["blob:local-preview"])
  })

  it("shows loading state during upload", async () => {
    let resolveFetch!: (v: any) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    renderPhotos()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [createMockFile("pic.jpg")] } })
    })

    expect(screen.getByTestId("icon-loading")).toBeInTheDocument()

    await act(async () => {
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ url: "https://example.com/photo.jpg" }),
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId("icon-loading")).not.toBeInTheDocument()
    })
  })

  it("clears file input value after upload", async () => {
    const { result } = renderPhotos()
    const input = findFileInput(result.container)

    await act(async () => {
      fireEvent.change(input, { target: { files: [createMockFile("pic.jpg")] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(input.value).toBe("")
  })
})

describe("FilePhotos — validation", () => {
  it("shows error for non-image files", async () => {
    const { result } = renderPhotos()
    const input = findFileInput(result.container)

    await act(async () => {
      fireEvent.change(input, { target: { files: [createNonImageFile()] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(screen.getByText("Apenas imagens são permitidas.")).toBeInTheDocument()
  })

  it("shows error for files over 5MB", async () => {
    const { result } = renderPhotos()
    const input = findFileInput(result.container)

    await act(async () => {
      fireEvent.change(input, { target: { files: [createOversizedFile()] } })
    })

    expect(screen.getByText("Cada imagem deve ter no máximo 5 MB.")).toBeInTheDocument()
  })

  it("rejects invalid files but still uploads valid ones (mixed batch)", async () => {
    const { onChange, result } = renderPhotos()
    const input = findFileInput(result.container)
    const validFile = createMockFile("valid.jpg")
    const invalidFile = createNonImageFile()

    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile, invalidFile] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(screen.getByText("Apenas imagens são permitidas.")).toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })
})

describe("FilePhotos — remove photos", () => {
  it("removes a photo when remove button is clicked", () => {
    const urls = ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"]
    const { onChange } = renderPhotos({ value: urls })

    const removeBtns = screen.getAllByLabelText("Remover foto 1")
    fireEvent.click(removeBtns[0])

    expect(onChange).toHaveBeenCalledWith(["https://example.com/photo2.jpg"])
  })

  it("removes correct photo by index", () => {
    const urls = ["url-a", "url-b", "url-c"]
    const { onChange } = renderPhotos({ value: urls })

    const removeBtns = screen.getAllByLabelText("Remover foto 2")
    fireEvent.click(removeBtns[0])

    expect(onChange).toHaveBeenCalledWith(["url-a", "url-c"])
  })
})

describe("FilePhotos — disabled state", () => {
  it("disables remove buttons when disabled", () => {
    const urls = ["https://example.com/photo.jpg"]
    renderPhotos({ value: urls, disabled: true })

    const removeBtns = screen.getAllByLabelText(/Remover foto/)
    removeBtns.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it("adds cursor-not-allowed class to drop zone when disabled", () => {
    renderPhotos({ disabled: true })
    const dropZone = screen.getByLabelText("Adicionar fotos")
    expect(dropZone.className).toContain("cursor-not-allowed")
  })
})

describe("FilePhotos — drag and drop", () => {
  it("adds bg-primary/5 on dragOver (dragging state)", () => {
    renderPhotos()
    const dropZone = screen.getByLabelText("Adicionar fotos")

    fireEvent.dragOver(dropZone)

    // Check as individual classes to avoid substring matches (hover:bg-primary/5)
    const classes = dropZone.className.split(/\s+/)
    expect(classes).toContain("bg-primary/5")
  })

  it("removes dragging background on dragLeave", () => {
    renderPhotos()
    const dropZone = screen.getByLabelText("Adicionar fotos")

    fireEvent.dragOver(dropZone)
    let classes = dropZone.className.split(/\s+/)
    expect(classes).toContain("bg-primary/5")

    fireEvent.dragLeave(dropZone)
    classes = dropZone.className.split(/\s+/)
    // bg-primary/5 is ONLY in the dragging=true branch, not in the false branch
    expect(classes).not.toContain("bg-primary/5")
  })

  it("uploads files on drop", async () => {
    renderPhotos()
    const dropZone = screen.getByLabelText("Adicionar fotos")
    const file = createMockFile("dropped.jpg")

    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer: { files: [file], types: ["Files"] } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(fetch).toHaveBeenCalledWith("/api/upload", expect.anything())
  })
})

describe("FilePhotos — keyboard accessibility", () => {
  it("handles Enter key on drop zone without crashing", () => {
    renderPhotos()
    const dropZone = screen.getByLabelText("Adicionar fotos")

    expect(() => {
      fireEvent.keyDown(dropZone, { key: "Enter", code: "Enter" })
    }).not.toThrow()
  })

  it("handles Space key on drop zone without crashing", () => {
    renderPhotos()
    const dropZone = screen.getByLabelText("Adicionar fotos")

    expect(() => {
      fireEvent.keyDown(dropZone, { key: " ", code: "Space" })
    }).not.toThrow()
  })
})
