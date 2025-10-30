import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import emailService from './services/emailService.js';

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
const necessidadesFile = path.join(dataDir, 'necessidades.json');

async function ensureJson(filePath, fallback = '[]') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, fallback, 'utf-8');
  }
}

async function readJson(filePath) {
  await ensureJson(filePath);
  try {
    const txt = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(txt || '[]');
  } catch {
    console.warn(`[admin] JSON inválido em ${filePath}. Resetando para []`);
    await fs.writeFile(filePath, '[]', 'utf-8');
    return [];
  }
}

async function writeJson(filePath, data) {
  await ensureJson(filePath);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

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

// Necessidades list
router.get('/necessidades', async (req, res) => {
  const { status = '', prioridade = '', categoria = '', query = '', page = '1', pageSize = '20' } = req.query || {};
  try {
    const all = await readJson(necessidadesFile);
    const filtered = all.filter(n => {
      // Filtro por status
      if (status && n.status !== status) return false;
      
      // Filtro por prioridade
      if (prioridade && n.prioridade !== prioridade) return false;
      
      // Filtro por categoria
      if (categoria && n.categoria !== categoria) return false;
      
      // Busca por texto
      if (query) {
        const q = String(query || '').toLowerCase();
        const searchableText = [
          n.necessitadoNome,
          n.item,
          n.descricao,
          n.categoria,
          n.enderecoEntrega?.cidade,
          n.enderecoEntrega?.uf,
          n.necessitadoContato?.email,
          n.necessitadoContato?.telefone
        ].map(x => (x || '').toLowerCase()).join(' ');
        
        if (!searchableText.includes(q)) return false;
      }
      
      return true;
    });
    
    // Ordenar por data de criação (mais recentes primeiro)
    filtered.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    
    const result = paginate(filtered, page, pageSize);
    res.json(result);
  } catch (e) {
    console.error('[admin] Falha ao listar necessidades, retornando vazio', e);
    res.json(paginate([], page, pageSize));
  }
});

router.get('/necessidades/:id', async (req, res) => {
  try {
    const all = await readJson(necessidadesFile);
    const n = all.find(x => x.id === req.params.id);
    if (!n) return res.status(404).json({ error: 'Necessidade não encontrada' });
    res.json(n);
  } catch (e) {
    console.error('[admin] Erro ao buscar necessidade', e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.patch('/necessidades/:id', async (req, res) => {
  const { status, observacaoInterna } = req.body || {};
  
  try {
    const all = await readJson(necessidadesFile);
    const idx = all.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Necessidade não encontrada' });
    
    const now = new Date().toISOString();
    const updates = {};
    
    if (status) updates.status = status;
    if (observacaoInterna !== undefined) updates.observacaoInterna = observacaoInterna;
    if (Object.keys(updates).length > 0) updates.atualizadoEm = now;
    
    all[idx] = {
      ...all[idx],
      ...updates,
      historicoStatus: [
        ...(all[idx].historicoStatus || []),
        status ? { 
          at: now, 
          by: 'admin', 
          status, 
          observacao: observacaoInterna || '' 
        } : undefined
      ].filter(Boolean)
    };
    
    await writeJson(necessidadesFile, all);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] Erro ao atualizar necessidade', e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Export CSV
router.get('/necessidades/export.csv', async (req, res) => {
  try {
    const all = await readJson(necessidadesFile);
    const csv = toCSV(all, [
      { label: 'Nome', accessor: 'necessitadoNome' },
      { label: 'Item', accessor: 'item' },
      { label: 'Prioridade', accessor: 'prioridade' },
      { label: 'Quantidade', accessor: 'quantidade' },
      { label: 'Categoria', accessor: 'categoria' },
      { label: 'Local', accessor: (n) => `${n.enderecoEntrega?.cidade||''}/${n.enderecoEntrega?.uf||''}` },
      { label: 'Status', accessor: 'status' },
      { label: 'Descrição', accessor: 'descricao' },
      { label: 'Email', accessor: (n) => n.necessitadoContato?.email || '' },
      { label: 'Telefone', accessor: (n) => n.necessitadoContato?.telefone || '' },
      { label: 'Criado em', accessor: 'criadoEm' },
      { label: 'Observação Interna', accessor: 'observacaoInterna' }
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="necessidades.csv"');
    res.send(csv);
  } catch (e) {
    console.error('[admin] Erro ao exportar necessidades', e);
    res.status(500).json({ error: 'Erro ao exportar' });
  }
});

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

export default router;
