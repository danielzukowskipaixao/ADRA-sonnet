import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import emailService from './services/emailService.js';
import { readJson as readJsonAtomic, writeJsonAtomic } from './lib/jsonStore.js';
import { NecessidadeSchema, NecessidadesListResponse, NecessidadesPatchSchema, AuditOverviewSchema } from './contracts/schemas.js';

// Load environment variables early to ensure ADMIN_PASSWORD and secrets are available
dotenv.config();

const router = express.Router();

// Config
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'daniel';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'admin-dev-secret';
const ADMIN_AUTH_DISABLED = String(process.env.ADMIN_AUTH_DISABLED || '').toLowerCase() === 'true';
const SESSION_EXPIRES_HOURS = 12; // 12h

// Storage paths
const dataDir = path.resolve(process.cwd(), 'server', 'data');
const beneficiariesFile = path.join(dataDir, 'beneficiaries.json');
const donationsFile = path.join(dataDir, 'donations.json');
// New file for help requests
const requestsFile = path.join(dataDir, 'requests.json');

async function ensureJson(filePath, fallback = '[]') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, fallback, 'utf-8');
  }
}

async function readJson(filePath) { return readJsonAtomic(filePath); }
async function writeJson(filePath, data) { return writeJsonAtomic(filePath, data); }

// Minimal in-memory rate limit for login: 5 attempts per 5 minutes per IP
const loginAttempts = new Map();
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 min
  const max = 5;
  const rec = loginAttempts.get(ip) || [];
  const recent = rec.filter(t => now - t < windowMs);
  if (recent.length >= max) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  next();
}

// Admin auth helpers
function signAdminToken(payload = {}) {
  return jwt.sign({ role: 'admin', ...payload }, ADMIN_SESSION_SECRET, { expiresIn: `${SESSION_EXPIRES_HOURS}h` });
}

function requireAdmin(req, res, next) {
  // Allow bypassing admin auth in development if explicitly enabled
  if (ADMIN_AUTH_DISABLED) {
    req.admin = { id: 'admin', role: 'admin', bypass: true };
    return next();
  }
  const token = req.cookies?.admin_session;
  if (!token) return res.status(401).json({ error: 'Sem sessão' });
  try {
    const decoded = jwt.verify(token, ADMIN_SESSION_SECRET);
    if (decoded?.role !== 'admin') throw new Error('not admin');
    req.admin = { id: 'admin', role: 'admin' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

// Login - versão simplificada para debug
router.post('/login', rateLimitLogin, (req, res) => {
  try {
    console.log('🔑 Tentativa de login recebida');
    const { password } = req.body || {};
    
    if (!password || typeof password !== 'string') {
      console.log('❌ Senha ausente');
      return res.status(400).json({ error: 'Senha ausente' });
    }
    
    console.log('🔍 Verificando senha...');
    console.log('Senha recebida:', password);
    console.log('Senha esperada:', ADMIN_PASSWORD);
    
    if (password !== ADMIN_PASSWORD) {
      console.log('❌ Senha incorreta');
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    
    console.log('✅ Senha correta, criando token...');
    const token = signAdminToken({ at: Date.now() });
    console.log('🎫 Token criado:', token ? 'sim' : 'não');
    
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_EXPIRES_HOURS * 60 * 60 * 1000,
      path: '/',
    });
    
    console.log('🎉 Login realizado com sucesso');
    res.json({ ok: true });
  } catch (error) {
    console.error('💥 Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('admin_session', { path: '/' });
  res.json({ ok: true });
});

// Helpers for filtering, pagination, csv
function paginate(array, page = 1, pageSize = 20) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const start = (p - 1) * ps;
  const items = array.slice(start, start + ps);
  return { items, page: p, pageSize: ps, total: array.length, pages: Math.ceil(array.length / ps) };
}

function toCSV(items, columns) {
  const header = columns.map(c => '"' + c.label.replaceAll('"', '""') + '"').join(',');
  const rows = items.map(it => columns.map(c => {
    const v = typeof c.accessor === 'function' ? c.accessor(it) : it[c.accessor];
    const s = v == null ? '' : String(v);
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(','));
  return [header, ...rows].join('\n');
}

// Protected routes below
router.use(requireAdmin);

// Beneficiaries list
router.get('/beneficiaries', async (req, res) => {
  const { status = 'pending', search = '', page = '1', pageSize = '20' } = req.query || {};
  try {
    const all = await readJson(beneficiariesFile);
    const filtered = all.filter(b => {
      const st = (b.status || 'pending') === status;
      if (!st) return false;
      const q = String(search || '').toLowerCase();
      if (!q) return true;
      const hay = [b.id, b.name, b.email, b.phone, b.address?.city, b.address?.state, b.document?.value].map(x => (x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
    const result = paginate(filtered, page, pageSize);
    res.json(result);
  } catch (e) {
    console.error('[admin] Falha ao listar beneficiários, retornando vazio', e);
    res.json(paginate([], page, pageSize));
  }
});

router.get('/beneficiaries/:id', async (req, res) => {
  const all = await readJson(beneficiariesFile);
  const b = all.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Não encontrado' });
  res.json(b);
});

router.patch('/beneficiaries/:id/validate', async (req, res) => {
  const { approved, reason } = req.body || {};
  if (approved === undefined) return res.status(400).json({ error: 'Campo approved é obrigatório' });
  if (approved === false && (!reason || !String(reason).trim())) {
    return res.status(400).json({ error: 'Motivo é obrigatório para rejeição' });
  }
  const all = await readJson(beneficiariesFile);
  const idx = all.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  
  const beneficiary = all[idx];
  const status = approved ? 'validated' : 'rejected';
  const now = new Date().toISOString();
  
  all[idx] = {
    ...all[idx],
    status,
    notes: reason || all[idx].notes,
    history: [
      ...(all[idx].history || []),
      { at: now, by: 'admin', action: approved ? 'validated' : 'rejected', details: reason || '' }
    ]
  };
  
  await writeJson(beneficiariesFile, all);
  
  // Enviar email para o beneficiário notificando sobre a decisão
  try {
    await emailService.sendBeneficiaryStatusUpdate(
      beneficiary.email,
      approved,
      reason || ''
    );
  } catch (emailError) {
    console.warn('⚠️ Falha ao enviar email de atualização para beneficiário:', emailError.message);
    // Não bloqueia a operação se o email falhar
  }
  
  res.json({ ok: true });
});

// Donations
router.get('/donations', async (req, res) => {
  const { status = '', search = '', page = '1', pageSize = '20' } = req.query || {};
  try {
    const all = await readJson(donationsFile);
    const filtered = all.filter(d => {
      const st = status ? d.status === status : true;
      if (!st) return false;
      const q = String(search || '').toLowerCase();
      if (!q) return true;
      const hay = [d.id, d.donor?.name, d.donor?.email, d.donor?.phone, d.address?.city, d.address?.state, d.type].map(x => (x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
    const result = paginate(filtered, page, pageSize);
    res.json(result);
  } catch (e) {
    console.error('[admin] Falha ao listar doações, retornando vazio', e);
    res.json(paginate([], page, pageSize));
  }
});

router.get('/donations/:id', async (req, res) => {
  const all = await readJson(donationsFile);
  const d = all.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Não encontrado' });
  res.json(d);
});

router.patch('/donations/:id', async (req, res) => {
  const patch = req.body || {};
  const all = await readJson(donationsFile);
  const idx = all.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    ...patch,
    timeline: [
      ...(all[idx].timeline || []),
      patch.status ? { at: now, by: 'admin', status: patch.status, note: patch.notes || '' } : undefined
    ].filter(Boolean)
  };
  await writeJson(donationsFile, all);
  res.json({ ok: true });
});

// Export CSV
router.get('/beneficiaries/export.csv', async (req, res) => {
  const all = await readJson(beneficiariesFile);
  const csv = toCSV(all, [
    { label: 'ID', accessor: 'id' },
    { label: 'Nome', accessor: 'name' },
    { label: 'Documento', accessor: (b) => `${b.document?.type||''}:${b.document?.value||''}` },
    { label: 'Email', accessor: 'email' },
    { label: 'Telefone', accessor: 'phone' },
    { label: 'Cidade/UF', accessor: (b) => `${b.address?.city||''}/${b.address?.state||''}` },
    { label: 'Status', accessor: 'status' },
    { label: 'Criado em', accessor: 'createdAt' }
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="beneficiaries.csv"');
  res.send(csv);
});

router.get('/donations/export.csv', async (req, res) => {
  const all = await readJson(donationsFile);
  const csv = toCSV(all, [
    { label: 'ID', accessor: 'id' },
    { label: 'Doador', accessor: (d) => d.donor?.name || '' },
    { label: 'Tipo', accessor: 'type' },
    { label: 'Status', accessor: 'status' },
    { label: 'Cidade/UF', accessor: (d) => `${d.address?.city||''}/${d.address?.state||''}` },
    { label: 'Itens', accessor: (d) => (d.items||[]).map(i => `${i.name} x${i.qty}`).join('; ') },
    { label: 'Criado em', accessor: 'createdAt' }
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
  res.send(csv);
});

// ----------------- NECESSIDADES (mapeadas a partir de requests) -----------------

function sanitizeQueryString(q) {
  const s = String(q || '').trim();
  return s.length > 200 ? s.slice(0, 200) : s;
}

function mapRequestToNecessidades(reqObj) {
  // reqObj: { id, contact, address, items[], createdAt, ... }
  const createdAt = reqObj.createdAt || new Date().toISOString();
  const updatedAt = reqObj.updatedAt || createdAt;
  const addr = reqObj.address || {};
  const contato = {
    email: reqObj.contact?.email,
    telefone: reqObj.contact?.phone,
  };
  const base = {
    necessitadoId: String(reqObj.userId || reqObj.id || ''),
    necessitadoNome: String(reqObj.contact?.name || '').trim() || 'Desconhecido',
    necessitadoContato: contato,
    enderecoEntrega: {
      rua: addr.logradouro || addr.rua,
      numero: addr.numero,
      bairro: addr.bairro,
      cidade: addr.cidade || addr.city,
      uf: addr.uf || addr.state,
      cep: addr.cep,
      referencia: addr.referencia,
      lat: reqObj.coordinates?.lat,
      lng: reqObj.coordinates?.lng,
    },
    criadoEm: createdAt,
    atualizadoEm: updatedAt,
  };
  const items = Array.isArray(reqObj.items) ? reqObj.items : [];
  return items.map((it, idx) => {
    const id = `${reqObj.id}#${idx}`;
    const prioridade = (reqObj.urgency || '').toLowerCase();
    const status = it?.admin?.status || 'pendente';
    const observacaoInterna = it?.admin?.observacaoInterna || undefined;
    const categoria = (it.category || '').toLowerCase();
    const cat = ['alimento','higiene','vestuario','mobilia','outros'].includes(categoria) ? categoria : 'outros';
    const necessidade = {
      id,
      ...base,
      item: String(it.name || '').trim() || 'item',
      categoria: cat,
      prioridade: ['baixa','media','alta'].includes(prioridade) ? prioridade : 'media',
      quantidade: it.quantity || it.qty || 1,
      descricao: reqObj.description || it.notes || '',
      status,
      observacaoInterna,
    };
    return NecessidadeSchema.parse(necessidade);
  });
}

router.get('/necessidades', async (req, res) => {
  try {
    const { query = '', status = '', prioridade = '', categoria = '', page = '1', pageSize = '20' } = req.query || {};
    const q = sanitizeQueryString(query);
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const allReq = await readJson(requestsFile);
    // flatten
    let flat = allReq.flatMap(mapRequestToNecessidades);
    // filters
    if (status) flat = flat.filter(n => (n.status || '') === status);
    if (prioridade) flat = flat.filter(n => (n.prioridade || '') === prioridade);
    if (categoria) flat = flat.filter(n => (n.categoria || '') === categoria);
    if (q) {
      const qq = q.toLowerCase();
      flat = flat.filter(n => [n.id, n.necessitadoNome, n.item, n.descricao, n.enderecoEntrega?.cidade, n.enderecoEntrega?.uf]
        .map(x => (x || '').toString().toLowerCase()).join(' ').includes(qq));
    }
    const total = flat.length;
    // sort default: prioridade (alta>media>baixa) then criadoEm desc
    const prioRank = { alta: 3, media: 2, baixa: 1 };
    flat.sort((a, b) => (prioRank[b.prioridade] - prioRank[a.prioridade]) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
    const items = flat.slice((p-1)*ps, (p-1)*ps + ps);
    const payload = { items, total, page: p, pageSize: ps, pages: Math.ceil(total / ps) };
    const parsed = NecessidadesListResponse.parse(payload);
    return res.json(parsed);
  } catch (e) {
    console.error('[admin/necessidades] erro lista', e);
    return res.status(500).json({ error: 'Erro ao listar necessidades' });
  }
});

router.patch('/necessidades/:id', async (req, res) => {
  try {
    const patch = NecessidadesPatchSchema.parse(req.body || {});
    const id = String(req.params.id);
    const [reqId, idxStr] = id.split('#');
    const idx = Number(idxStr);
    if (!reqId || Number.isNaN(idx)) return res.status(400).json({ error: 'ID inválido' });
    const allReq = await readJson(requestsFile);
    const pos = allReq.findIndex(r => r.id === reqId);
    if (pos === -1) return res.status(404).json({ error: 'Não encontrado' });
    const reqObj = allReq[pos];
    if (!Array.isArray(reqObj.items) || !reqObj.items[idx]) return res.status(404).json({ error: 'Item não encontrado' });
    const now = new Date().toISOString();
    reqObj.items[idx].admin = {
      ...(reqObj.items[idx].admin || {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.observacaoInterna ? { observacaoInterna: patch.observacaoInterna } : {}),
      atualizadoEm: now,
    };
    reqObj.updatedAt = now;
    allReq[pos] = reqObj;
    await writeJson(requestsFile, allReq);
    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Payload inválido' });
    }
    console.error('[admin/necessidades] erro patch', e);
    return res.status(500).json({ error: 'Erro ao atualizar necessidade' });
  }
});

router.get('/necessidades/export.csv', async (req, res) => {
  try {
    // reuse same filtering as list
    const url = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
    const params = Object.fromEntries(url.searchParams.entries());
    const fakeReq = { query: params };
    let list = [];
    {
      const { query = '', status = '', prioridade = '', categoria = '' } = params || {};
      const q = sanitizeQueryString(query);
      const allReq = await readJson(requestsFile);
      list = allReq.flatMap(mapRequestToNecessidades);
      if (status) list = list.filter(n => (n.status || '') === status);
      if (prioridade) list = list.filter(n => (n.prioridade || '') === prioridade);
      if (categoria) list = list.filter(n => (n.categoria || '') === categoria);
      if (q) {
        const qq = q.toLowerCase();
        list = list.filter(n => [n.id, n.necessitadoNome, n.item, n.descricao, n.enderecoEntrega?.cidade, n.enderecoEntrega?.uf]
          .map(x => (x || '').toString().toLowerCase()).join(' ').includes(qq));
      }
    }
    const csv = toCSV(list, [
      { label: 'ID', accessor: 'id' },
      { label: 'Necessitado', accessor: 'necessitadoNome' },
      { label: 'Item', accessor: 'item' },
      { label: 'Categoria', accessor: 'categoria' },
      { label: 'Prioridade', accessor: 'prioridade' },
      { label: 'Quantidade', accessor: 'quantidade' },
      { label: 'Cidade/UF', accessor: (n) => `${n.enderecoEntrega?.cidade||''}/${n.enderecoEntrega?.uf||''}` },
      { label: 'Status', accessor: 'status' },
      { label: 'Criado em', accessor: 'criadoEm' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="necessidades.csv"');
    res.send(csv);
  } catch (e) {
    console.error('[admin/necessidades] erro export', e);
    res.status(500).send('Erro ao exportar CSV');
  }
});

// ----------------- Auditoria -----------------
router.get('/audit/overview', async (_req, res) => {
  try {
    const [beneficiaries, donations, requests] = await Promise.all([
      readJson(beneficiariesFile),
      readJson(donationsFile),
      readJson(requestsFile),
    ]);
    const necessidades = requests.flatMap(mapRequestToNecessidades);
    const violations = [];
    // simple checks
    for (const r of requests) {
      if (!Array.isArray(r.items) || r.items.length === 0) {
        violations.push({ tipo: 'registro_orfao', id: String(r.id), origemEsperada: 'necessidades', abaDetectada: 'nenhuma', motivo: 'Pedido sem itens' });
      }
      if (!r.contact?.name) {
        violations.push({ tipo: 'campo_invalido', id: String(r.id), origemEsperada: 'necessidades', abaDetectada: 'necessidades', motivo: 'Pedido sem nome de contato' });
      }
    }
    // beneficiaries pending validation
    const pendencias = (beneficiaries || []).filter(b => (b.status || 'pending') === 'pending');
    // Basic duplication check by id across tabs (illustrative)
    const ids = new Set();
    const markSeen = (id, origem) => {
      if (ids.has(id)) violations.push({ tipo: 'aba_errada', id: String(id), origemEsperada: origem, abaDetectada: origem, motivo: 'ID duplicado em múltiplas coleções' });
      ids.add(id);
    };
  pendencias.forEach(b => markSeen(`B:${b.id}`, 'validacoes'));
  (donations||[]).forEach(d => markSeen(`D:${d.id}`, 'coletas'));
  necessidades.forEach(n => markSeen(`N:${n.id}`, 'necessidades'));

    const payload = { ok: violations.length === 0, counts: { pendenciasValidacao: pendencias.length, coletasEntregas: (donations||[]).length, necessidades: necessidades.length }, violations };
    const parsed = AuditOverviewSchema.parse(payload);
    res.json(parsed);
  } catch (e) {
    console.error('[admin/audit] erro overview', e);
    res.status(500).json({ ok: false, counts: { pendenciasValidacao: 0, coletasEntregas: 0, necessidades: 0 }, violations: [{ tipo: 'erro_backend', id: '-', origemEsperada: '-', abaDetectada: '-', motivo: e.message||'erro' }] });
  }
});
// New: Requests list for admin
router.get('/requests', async (req, res) => {
  const { status = '', search = '', page = '1', pageSize = '20' } = req.query || {};
  try {
    const all = await readJson(requestsFile);
    const filtered = all.filter(r => {
      const st = status ? (r.status || '') === status : true;
      if (!st) return false;
      const q = String(search || '').toLowerCase();
      if (!q) return true;
      const hay = [r.id, r.contact?.name, r.contact?.email, r.contact?.phone, r.address?.cidade || r.address?.city, r.address?.uf || r.address?.state, r.urgency, (r.items||[]).map(i=>i.name).join(' ')].map(x => (x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
    const result = paginate(filtered, page, pageSize);
    res.json(result);
  } catch (e) {
    console.error('[admin] Falha ao listar pedidos, retornando vazio', e);
    res.json(paginate([], page, pageSize));
  }
});

router.get('/requests/export.csv', async (_req, res) => {
  const all = await readJson(requestsFile);
  const csv = toCSV(all, [
    { label: 'ID', accessor: 'id' },
    { label: 'Nome', accessor: (r) => r.contact?.name || '' },
    { label: 'Email', accessor: (r) => r.contact?.email || '' },
    { label: 'Telefone', accessor: (r) => r.contact?.phone || '' },
    { label: 'Cidade/UF', accessor: (r) => `${r.address?.cidade||r.address?.city||''}/${r.address?.uf||r.address?.state||''}` },
    { label: 'Urgência', accessor: (r) => r.urgency || '' },
    { label: 'Itens', accessor: (r) => (r.items||[]).map(i => `${i.name} x${i.qty||i.quantity||1}`).join('; ') },
    { label: 'Criado em', accessor: 'createdAt' }
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="requests.csv"');
  res.send(csv);
});

export default router;
