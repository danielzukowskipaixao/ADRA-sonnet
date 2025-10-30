import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { initDb, prisma } from './db.js';
import adminRouter from './admin.js';
import { registerUser, loginUser, getUserFromToken } from './auth.js';
import emailService from './services/emailService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
if (process.env.DATABASE_URL) {
  await initDb();
} else {
  console.warn('⚠️ DATABASE_URL não definido; pulando conexão Prisma.');
}

const app = express();
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Simple file-based storage for pickup schedules
const dataDir = path.resolve(process.cwd(), 'server', 'data');
const schedulesFile = path.join(dataDir, 'schedules.json');
const beneficiariesFile = path.join(dataDir, 'beneficiaries.json');
const necessidadesFile = path.join(dataDir, 'necessidades.json');

async function ensureDataFile() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.access(schedulesFile).catch(async () => {
      await fs.writeFile(schedulesFile, '[]', 'utf-8');
    });
  } catch (e) {
    console.error('Erro ao preparar storage de agendamentos', e);
  }
}

async function readSchedules() {
  await ensureDataFile();
  const txt = await fs.readFile(schedulesFile, 'utf-8');
  return JSON.parse(txt || '[]');
}

async function writeSchedules(list) {
  await ensureDataFile();
  await fs.writeFile(schedulesFile, JSON.stringify(list, null, 2), 'utf-8');
}

async function ensureBeneficiariesFile() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.access(beneficiariesFile).catch(async () => {
      await fs.writeFile(beneficiariesFile, '[]', 'utf-8');
    });
  } catch (e) {
    console.error('Erro ao preparar storage de beneficiários', e);
  }
}

async function readBeneficiaries() {
  await ensureBeneficiariesFile();
  const txt = await fs.readFile(beneficiariesFile, 'utf-8');
  return JSON.parse(txt || '[]');
}

async function writeBeneficiaries(list) {
  await ensureBeneficiariesFile();
  await fs.writeFile(beneficiariesFile, JSON.stringify(list, null, 2), 'utf-8');
}

async function ensureNecessidadesFile() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.access(necessidadesFile).catch(async () => {
      await fs.writeFile(necessidadesFile, '[]', 'utf-8');
    });
  } catch (e) {
    console.error('Erro ao preparar storage de necessidades', e);
  }
}

async function readNecessidades() {
  await ensureNecessidadesFile();
  const txt = await fs.readFile(necessidadesFile, 'utf-8');
  return JSON.parse(txt || '[]');
}

async function writeNecessidades(list) {
  await ensureNecessidadesFile();
  await fs.writeFile(necessidadesFile, JSON.stringify(list, null, 2), 'utf-8');
}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Register
app.post('/auth/register', async (req, res) => {
  try {
    const required = ['name','email','senha','telefone','endereco','cidade','estado'];
    for (const f of required) if (!req.body[f]) return res.status(400).json({ error: `Campo obrigatório: ${f}` });
    const user = await registerUser(req.body);
    return res.status(201).json(user);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'E-mail ou telefone já cadastrado' });
    console.error(e);
    res.status(500).json({ error: 'Erro ao registrar' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  const result = await loginUser({ email, senha });
  if (!result) return res.status(401).json({ error: 'Credenciais inválidas' });
  res.json(result);
});

// Auth middleware
async function auth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    req.user = await getUserFromToken(token);
  }
  next();
}
app.use(auth);

// Current user
app.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  res.json(req.user);
});

// Admin API
app.use('/api/admin', adminRouter);

// Public endpoint: ingest beneficiary from client registration (file-based)
app.post('/api/beneficiaries', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const body = req.body || {};
    const name = body.nome || body.name || '';
    const email = body.email || '';
    const phone = body.telefone || body.phone || '';
    const city = body.cidade || body.city || '';
    const state = body.estado || body.state || '';
    const document = body.document || null; // { type, value } opcional

    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }

    const all = await readBeneficiaries();
    const byEmailIdx = all.findIndex(b => (b.email || '').toLowerCase() === String(email).toLowerCase());
    const id = byEmailIdx >= 0 ? all[byEmailIdx].id : (body.id || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`);

    const record = {
      id,
      name,
      email,
      phone,
      address: { city, state },
      document: document || (body.cpf ? { type: 'CPF', value: body.cpf } : undefined),
      status: 'pending',
      createdAt: byEmailIdx >= 0 ? all[byEmailIdx].createdAt : now,
      notes: byEmailIdx >= 0 ? all[byEmailIdx].notes : '',
      history: [
        ...(byEmailIdx >= 0 ? (all[byEmailIdx].history || []) : []),
        { at: now, by: 'system', action: byEmailIdx >= 0 ? 'update' : 'create', details: '' }
      ]
    };

    const isNewBeneficiary = byEmailIdx < 0;
    
    if (byEmailIdx >= 0) {
      all[byEmailIdx] = { ...all[byEmailIdx], ...record };
    } else {
      all.push(record);
    }
    await writeBeneficiaries(all);
    
    // Enviar notificação por email para administradores (apenas para novos cadastros)
    if (isNewBeneficiary) {
      try {
        await emailService.sendNewBeneficiaryNotification(record);
      } catch (emailError) {
        console.warn('⚠️ Falha ao enviar email de notificação:', emailError.message);
        // Não bloqueia o cadastro se o email falhar
      }
    }
    
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error('Erro ao registrar beneficiário (arquivo)', e);
    res.status(500).json({ error: 'Erro ao registrar beneficiário' });
  }
});

// Public endpoint: check beneficiary status by email (to inform users on waiting page)
app.get('/api/beneficiaries/status', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Parâmetro email é obrigatório' });
    const all = await readBeneficiaries();
    const b = all.find(x => (x.email || '').toLowerCase() === email);
    if (!b) return res.json({ exists: false, status: 'unknown' });
    return res.json({ exists: true, status: b.status || 'pending', reason: b.notes || '' });
  } catch (e) {
    console.error('Erro em /api/beneficiaries/status', e);
    res.status(500).json({ error: 'Erro ao consultar status' });
  }
});

// List users (temporário demo)
app.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email })));
});

// Create necessity request
app.post('/api/necessidades', async (req, res) => {
  try {
    const {
      userId,
      address,
      items,
      urgency,
      description,
      termsAccepted
    } = req.body || {};

    // Validações
    if (!userId) return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    if (!address) return res.status(400).json({ error: 'Endereço é obrigatório' });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Lista de itens é obrigatória' });
    }
    if (!termsAccepted) return res.status(400).json({ error: 'Aceite dos termos é obrigatório' });

    // Buscar dados do usuário (se disponível)
    let userName = 'Usuário não identificado';
    let userEmail = '';
    let userPhone = '';
    try {
      const beneficiaries = await readBeneficiaries();
      const user = beneficiaries.find(b => b.id === userId);
      if (user) {
        userName = user.name || userName;
        userEmail = user.email || '';
        userPhone = user.phone || '';
      }
    } catch (e) {
      console.warn('Erro ao buscar dados do usuário:', e);
    }

    const necessidades = await readNecessidades();
    const now = new Date().toISOString();
    
    // Criar um registro para cada item
    const newNecessidades = items.map((item, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      necessitadoNome: userName,
      necessitadoContato: {
        email: userEmail,
        telefone: userPhone
      },
      item: item.name,
      categoria: item.category,
      quantidade: item.quantity,
      unidade: item.unit || 'unidade',
      descricao: item.notes || description || '',
      prioridade: urgency || 'media',
      enderecoEntrega: address.coordinates ? {
        tipo: 'coordenadas',
        coordenadas: address.coordinates,
        endereco: 'Localização via GPS'
      } : {
        tipo: 'endereco',
        cep: address.cep,
        logradouro: address.logradouro,
        numero: address.numero,
        complemento: address.complemento,
        bairro: address.bairro,
        cidade: address.cidade,
        uf: address.uf,
        endereco: `${address.logradouro}, ${address.numero}${address.complemento ? `, ${address.complemento}` : ''}, ${address.bairro}`
      },
      status: 'pendente',
      observacaoInterna: '',
      criadoEm: now,
      atualizadoEm: now,
      termsAccepted,
      originalRequest: {
        urgency,
        description,
        submittedAt: now
      }
    }));

    necessidades.push(...newNecessidades);
    await writeNecessidades(necessidades);

    return res.status(201).json({ 
      ok: true, 
      count: newNecessidades.length,
      ids: newNecessidades.map(n => n.id) 
    });
  } catch (e) {
    console.error('Erro ao criar pedido de necessidades', e);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

// Schedule pickup request
app.post('/coletas/agendar', async (req, res) => {
  try {
    const {
      nome,
      telefone,
      email,
      endereco,
      complemento,
      cidade,
      estado,
      cep,
      origem,
      disponibilidade, // texto livre ou estrutura
      itens, // opcional
      observacoes,
      unidadePreferida // opcional
    } = req.body || {};

    // validações básicas
    const required = { nome, telefone, endereco, disponibilidade };
    for (const [k, v] of Object.entries(required)) {
      if (!v || (typeof v === 'string' && !v.trim())) {
        return res.status(400).json({ error: `Campo obrigatório: ${k}` });
      }
    }

    const schedules = await readSchedules();
    const now = new Date().toISOString();
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      usuarioId: req.user?.id || null,
      nome,
      telefone,
      email: email || null,
      endereco,
      complemento: complemento || null,
      cidade: cidade || null,
      estado: estado || null,
      cep: cep || null,
      origem: origem || null, // { type, coords, text }
      disponibilidade,
      itens: itens || null,
      observacoes: observacoes || null,
      unidadePreferida: unidadePreferida || null,
      status: 'novo'
    };
    schedules.push(record);
    await writeSchedules(schedules);
    return res.status(201).json({ ok: true, id: record.id });
  } catch (e) {
    console.error('Erro ao criar agendamento de coleta', e);
    res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando em http://localhost:${PORT}`));
