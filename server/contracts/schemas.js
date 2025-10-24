import { z } from 'zod';

export const ContatoSchema = z.object({
  email: z.string().email().optional(),
  telefone: z.string().min(8).max(20).optional(),
});

export const EnderecoSchema = z.object({
  rua: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  referencia: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const NecessidadeSchema = z.object({
  id: z.string(),
  necessitadoId: z.string(),
  necessitadoNome: z.string().min(1),
  necessitadoContato: ContatoSchema.optional(),
  item: z.string().min(1),
  categoria: z.enum(["alimento", "higiene", "vestuario", "mobilia", "outros"]).optional().default('outros'),
  prioridade: z.enum(["baixa", "media", "alta"]).optional().default('media'),
  quantidade: z.union([z.string(), z.number()]).optional(),
  descricao: z.string().optional(),
  enderecoEntrega: EnderecoSchema.partial(),
  status: z.enum(["pendente", "em_analise", "atendida", "parcial"]).default('pendente'),
  criadoEm: z.string(),
  atualizadoEm: z.string(),
  observacaoInterna: z.string().optional(),
});

export const NecessidadesListResponse = z.object({
  items: z.array(NecessidadeSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
});

export const NecessidadesPatchSchema = z.object({
  status: z.enum(["pendente", "em_analise", "atendida", "parcial"]).optional(),
  observacaoInterna: z.string().optional(),
});

export const AuditOverviewSchema = z.object({
  ok: z.boolean(),
  counts: z.object({
    pendenciasValidacao: z.number().int().nonnegative(),
    coletasEntregas: z.number().int().nonnegative(),
    necessidades: z.number().int().nonnegative(),
  }),
  violations: z.array(z.object({
    tipo: z.string(),
    id: z.string(),
    origemEsperada: z.string(),
    abaDetectada: z.string(),
    motivo: z.string(),
  })),
});

// Minimal d.ts for editors
// This is intentionally simple to avoid TS build requirements
/**
 * @typedef {import('zod').infer<typeof NecessidadeSchema>} Necessidade
 */
