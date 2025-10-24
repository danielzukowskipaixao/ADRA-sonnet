# Fluxo de Dados – Admin

Este documento descreve o mapeamento “origem → aba destino” e as verificações da auditoria.

```mermaid
graph TD
  A[Cadastro Beneficiário] -->|status: pending| V[Admin: Validações pendentes]
  B[Formulário Doações (Coletas/Entregas)] --> C[server/data/donations.json]
  C --> D[Admin: Coletas/Entregas]
  E[Pedido de Doação (Necessitado)] --> F[server/data/requests.json]
  F -->|flatten items| G[Admin: Necessidades]
```

## Regras de Mapeamento
- Validações pendentes: `beneficiaries.json` com `status=pending`
- Coletas/Entregas: `donations.json`
- Necessidades: requests em `requests.json` achatados por item (`id = requestId#itemIndex`)

## Auditoria
- Endpoint: `GET /api/admin/audit/overview`
- Verifica:
  - Pedidos sem itens → `registro_orfao`
  - Campos essenciais ausentes (ex.: contato sem nome) → `campo_invalido`
  - Duplicidades de IDs cruzadas → `aba_errada`
- Resposta:
```json
{
  "ok": true,
  "counts": { "pendenciasValidacao": 0, "coletasEntregas": 0, "necessidades": 0 },
  "violations": []
}
```

## Observações
- Persistência dual: hoje JSON; a estrutura suporta evolução para Prisma/SQLite (mesma forma de saída validada por Zod)
- Todas as respostas do admin devem atender aos contratos Zod compartilhados
