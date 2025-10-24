# Plano de Testes – Admin (Sem dados falsos)

Objetivo: validar a aba “Necessidades”, auditoria de dados e rotas admin com autorização, sem criar seeds/fixtures. Todos os dados devem ser gerados pela própria UI.

## Pré-requisitos
- Backend em http://localhost:3000 (ADMIN_PASSWORD definido)
- Frontend em http://localhost:5173
- Login admin na Home → “Entrar como administrador” → senha `daniel`

## Geração de dados reais (via UI)

1) Usuário necessitado – criar pedido de doações
- Crie/valide uma conta pelo fluxo de necessitado (Login/Cadastro, validação)
- Acesse “Pedir Doação”
- Preencha endereço OU use coordenadas, adicione 1–2 itens, aceite termos e envie
- Resultado esperado: o pedido aparece mapeado na aba “Necessidades” (uma linha por item)

2) Doador – criar pedido de coleta/entrega
- Acesse a página de doações e crie um pedido de coleta/entrega
- Resultado esperado: pedido aparece na aba “Coletas/Entregas”

3) Beneficiário aguardando validação
- Faça um cadastro de beneficiário pelo fluxo do site
- Sem aprovar ainda
- Resultado esperado: aparece em “Validações pendentes”

## Verificações

1) Aba Necessidades
- Filtre por status (pendente, em_analise, parcial, atendida)
- Filtre por prioridade (baixa, media, alta)
- Filtre por categoria (alimento, higiene, vestuario, mobilia, outros)
- Ordenação padrão: prioridade (alta > média > baixa), depois criadoEm (desc)
- Paginação: mude de página e confira que total/páginas batem
- Atualização de status: mude status de uma linha e adicione observação interna; verifique persistência ao recarregar
- Exportar CSV: baixe e confira que respeita filtros

2) Auditoria
- Acesse o painel admin e verifique o banner
- Chame manualmente GET /api/admin/audit/overview (autenticado)
- Com dados válidos, resposta: `{ ok: true, violations: [] }`
- Se houver dados incompletos (ex.: pedido sem itens), `ok: false` com `violations` detalhando o item

3) Autorização e contratos
- Tente acessar qualquer rota /api/admin/* sem estar logado → 401
- Verifique no console do navegador mensagens de “Dados inesperados (contrato violado)” se houver quebra de contrato

## Critérios de aceite
- Nenhum seed/dado inventado
- Rotas admin protegidas (401 sem sessão)
- Respostas do admin validadas com Zod no cliente
- Auditoria ok=true com dados válidos e ok=false com violações quando induzidas
- Export CSV respeita filtros e paginação
- As outras abas continuam funcionais
