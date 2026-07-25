"use client";

import * as React from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { BadgeCheck, ImagePlus, Loader2, LocateFixed, Save, X } from "lucide-react";

import { apiGet, apiPatch } from "@/lib/api";
import { providerProfileSchema, type ProviderProfileInput } from "@/lib/validators";
import { useAuthStore } from "@/store/auth";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

const UF_OPTIONS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

// ---------------------------------------------------------------------------
// Single photo uploader (avatar or cover)
// ---------------------------------------------------------------------------

function SinglePhoto({
  value,
  onChange,
  label,
  aspect = "square",
  max = 1,
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  label: string;
  aspect?: "square" | "wide";
  max?: number;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        // Fallback to local object URL
        onChange(URL.createObjectURL(file));
      } else {
        onChange(data.url as string);
      }
    } catch {
      onChange(URL.createObjectURL(file));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div
        className={
          aspect === "square"
            ? "relative size-24 overflow-hidden rounded-lg border bg-muted"
            : "relative h-32 w-full overflow-hidden rounded-lg border bg-muted"
        }
      >
        {value ? (
          <Image
            src={value}
            alt={label}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, 384px"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImagePlus className="size-6" />
          </div>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            aria-label="Remover imagem"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="gap-1.5"
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ImagePlus className="size-3.5" />
        )}
        {value ? "Trocar" : "Enviar"}
      </Button>
      {max > 1 && <p className="text-[10px] text-muted-foreground">Aceita até {max} imagens.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderProfile() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  const profileQuery = useQuery<{
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      cpfCnpj?: string | null;
      whatsapp?: string | null;
      phone?: string | null;
      avatarUrl?: string | null;
      coverUrl?: string | null;
      bio?: string | null;
      cep?: string | null;
      street?: string | null;
      number?: string | null;
      complement?: string | null;
      district?: string | null;
      city?: string | null;
      state?: string | null;
      lat?: number | null;
      lng?: number | null;
      radiusKm?: number | null;
      verified: boolean;
    };
  }>({
    queryKey: ["provider", "profile", user?.id],
    queryFn: async () => apiGet("/api/users/me"),
    enabled: !!user,
  });

  const profile = profileQuery.data?.user;

  const form = useForm<ProviderProfileInput>({
    resolver: zodResolver(providerProfileSchema) as unknown as Resolver<ProviderProfileInput>,
    defaultValues: {
      name: "",
      bio: "",
      whatsapp: "",
      phone: "",
      avatarUrl: "",
      coverUrl: "",
      cep: "",
      street: "",
      number: "",
      complement: "",
      district: "",
      city: "",
      state: "",
      lat: undefined,
      lng: undefined,
      radiusKm: 15,
    },
  });

  // Hydrate
  React.useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name ?? "",
        bio: profile.bio ?? "",
        whatsapp: profile.whatsapp ?? "",
        phone: profile.phone ?? "",
        avatarUrl: profile.avatarUrl ?? "",
        coverUrl: profile.coverUrl ?? "",
        cep: profile.cep ?? "",
        street: profile.street ?? "",
        number: profile.number ?? "",
        complement: profile.complement ?? "",
        district: profile.district ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        lat: profile.lat ?? undefined,
        lng: profile.lng ?? undefined,
        radiusKm: profile.radiusKm ?? 15,
      });
    }
  }, [profile, form]);

  const [saving, setSaving] = React.useState(false);

  const useGPS = async () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada neste dispositivo.");
      return;
    }
    toast.info("Obtendo sua localização…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        form.setValue("lat", latitude);
        form.setValue("lng", longitude);
        // Try reverse geocoding
        try {
          const data = await apiGet<{
            street?: string;
            district?: string;
            city?: string;
            state?: string;
            cep?: string;
          }>("/api/geo/reverse", { lat: latitude, lng: longitude });
          if (data.cep) form.setValue("cep", data.cep);
          if (data.street) form.setValue("street", data.street);
          if (data.district) form.setValue("district", data.district);
          if (data.city) form.setValue("city", data.city);
          if (data.state) form.setValue("state", data.state);
          toast.success("Localização capturada.");
        } catch {
          toast.success("Coordenadas capturadas. Preencha o endereço manualmente.");
        }
      },
      () => {
        toast.error("Não foi possível obter sua localização.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      await apiPatch("/api/users/me", values);
      toast.success("Perfil atualizado com sucesso.");
      qc.invalidateQueries({ queryKey: ["provider", "profile", user?.id] });
      // Refresh auth store user (for name/avatar)
      await fetchMe();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message ?? "Erro ao atualizar perfil.");
    } finally {
      setSaving(false);
    }
  });

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Carregando perfil…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Não foi possível carregar o perfil.
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={submit} className="grid gap-6">
        {/* Cover + avatar preview */}
        <Card className="py-0">
          <CardContent className="p-4">
            <div className="relative h-32 w-full overflow-hidden rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 sm:h-40">
              {form.watch("coverUrl") && (
                <Image
                  src={form.watch("coverUrl") ?? ""}
                  alt="Capa"
                  fill
                  className="object-cover"
                  sizes="100vw"
                />
              )}
              <div className="absolute -bottom-8 left-4 flex items-end gap-3">
                <Avatar className="size-16 border-4 border-background sm:size-20">
                  {form.watch("avatarUrl") ? (
                    <AvatarImage src={form.watch("avatarUrl") ?? ""} alt={profile.name} />
                  ) : null}
                  <AvatarFallback className="bg-primary text-lg text-primary-foreground">
                    {profile.name
                      ?.split(" ")
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase())
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-sm font-semibold text-white drop-shadow">{profile.name}</p>
                  {profile.verified && (
                    <Badge className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-medium text-emerald-700 shadow">
                      <BadgeCheck className="size-3" /> Verificado
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <SinglePhoto
                label="Foto de perfil"
                value={form.watch("avatarUrl")}
                onChange={(url) => form.setValue("avatarUrl", url ?? "", { shouldDirty: true })}
                aspect="square"
              />
              <SinglePhoto
                label="Capa do perfil"
                value={form.watch("coverUrl")}
                onChange={(url) => form.setValue("coverUrl", url ?? "", { shouldDirty: true })}
                aspect="wide"
              />
            </div>
          </CardContent>
        </Card>

        {/* Personal info */}
        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">Informações pessoais</CardTitle>
            <CardDescription className="text-xs">
              Esses dados aparecem publicamente na sua página de prestador.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome / Empresa</FormLabel>
                  <FormControl>
                    <Input placeholder="Seu nome ou nome da empresa" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <FormLabel>E-mail</FormLabel>
                <Input value={profile.email} disabled />
                <p className="text-[10px] text-muted-foreground">O e-mail não pode ser alterado.</p>
              </div>
              <div className="grid gap-1.5">
                <FormLabel className="flex items-center gap-1.5">
                  CPF/CNPJ
                  {profile.verified && (
                    <Badge className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <BadgeCheck className="size-2.5" /> Verificado
                    </Badge>
                  )}
                </FormLabel>
                <Input value={profile.cpfCnpj ?? ""} disabled />
                <p className="text-[10px] text-muted-foreground">
                  Documento verificado. Não editável.
                </p>
              </div>
            </div>

            <FormField
              control={form.control}
              name="bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      maxLength={600}
                      placeholder="Conte um pouco sobre você e seus serviços…"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Máximo 600 caracteres.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="whatsapp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp</FormLabel>
                    <FormControl>
                      <Input placeholder="(11) 99999-9999" inputMode="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone fixo (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="(11) 3000-0000" inputMode="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card className="py-0">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3">
            <div>
              <CardTitle className="text-sm">Endereço e atendimento</CardTitle>
              <CardDescription className="text-xs">
                Define sua base de atendimento no mapa.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useGPS} className="gap-1.5">
              <LocateFixed className="size-3.5" /> Usar GPS
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <FormField
                control={form.control}
                name="cep"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CEP</FormLabel>
                    <FormControl>
                      <Input placeholder="00000-000" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="street"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rua / Avenida</FormLabel>
                    <FormControl>
                      <Input placeholder="Rua, avenida…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número</FormLabel>
                    <FormControl>
                      <Input placeholder="123" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="complement"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Complemento</FormLabel>
                    <FormControl>
                      <Input placeholder="Apto, bloco…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="district"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bairro</FormLabel>
                    <FormControl>
                      <Input placeholder="Bairro" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input placeholder="Cidade" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UF</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Estado" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {UF_OPTIONS.map((uf) => (
                          <SelectItem key={uf} value={uf}>
                            {uf}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="radiusKm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Raio de atendimento:{" "}
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {(field.value ?? 15).toFixed(0)} km
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={100}
                      step={1}
                      value={[field.value ?? 15]}
                      onValueChange={(v) => field.onChange(v[0])}
                    />
                  </FormControl>
                  <FormDescription>
                    Clientes dentro desse raio verão você com prioridade na busca.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("lat") != null && form.watch("lng") != null && (
              <p className="text-xs text-muted-foreground">
                Localização: {form.watch("lat")?.toFixed(5)}, {form.watch("lng")?.toFixed(5)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar alterações
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default ProviderProfile;
