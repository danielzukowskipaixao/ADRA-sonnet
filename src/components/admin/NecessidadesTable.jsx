import React, { useState } from 'react';
import Button from '../Button';

function RowActions({ id, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [obs, setObs] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const submit = async () => {
    const patch = {};
    if (status) patch.status = status;
    if (obs) patch.observacaoInterna = obs;
    if (Object.keys(patch).length === 0) return;
    await onUpdate(id, patch);
    setOpen(false);
    setStatus('');
    setObs('');
  };

  const handleDelete = async () => {
    try {
      await onDelete(id);
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Erro ao excluir:', error);
      alert('Erro ao excluir a necessidade');
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
        {open ? 'Cancelar' : 'Atualizar'}
      </Button>
      {open && (
        <div className="flex items-center gap-2">
          <select 
            className="border rounded px-2 py-1 text-sm" 
            value={status} 
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Status...</option>
            <option value="pendente">Pendente</option>
            <option value="em_analise">Em análise</option>
            <option value="parcial">Parcial</option>
            <option value="atendida">Atendida</option>
            <option value="excluir" className="text-red-600">Excluir conta</option>
          </select>
          {status !== 'excluir' && (
            <input 
              className="border rounded px-2 py-1 text-sm" 
              placeholder="Observação interna" 
              value={obs} 
              onChange={(e) => setObs(e.target.value)} 
            />
          )}
          {status === 'excluir' ? (
            <div className="flex items-center gap-2">
              <span className="text-red-600 text-sm">Confirmar exclusão?</span>
              <Button size="sm" variant="secondary" onClick={() => setStatus('')}>
                Cancelar
              </Button>
              <Button 
                size="sm" 
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Excluir
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={submit}>Salvar</Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function NecessidadesTable({ items = [], total = 0, page = 1, pages = 0, onPrev, onNext, onUpdate, onDelete }) {
  const isEmpty = !items || items.length === 0;
  
  if (isEmpty) {
    return (
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 text-center text-gray-600">
          Não há necessidade cadastrada ainda.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">Necessitado</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Prioridade</th>
              <th className="px-3 py-2">Qtd</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Local</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Criado em</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id} className="border-b">
                <td className="px-3 py-2 text-sm text-gray-700">
                  <div className="font-medium">{n.necessitadoNome}</div>
                  <div className="text-gray-500 text-xs">
                    {n.necessitadoContato?.email || n.necessitadoContato?.telefone || '-'}
                  </div>
                </td>
                <td className="px-3 py-2 text-sm">
                  <div className="font-medium">{n.item}</div>
                  <div className="text-gray-500 text-xs truncate max-w-xs" title={n.descricao || ''}>
                    {n.descricao || '-'}
                  </div>
                </td>
                <td className="px-3 py-2 text-sm">{n.prioridade}</td>
                <td className="px-3 py-2 text-sm">{n.quantidade || '-'}</td>
                <td className="px-3 py-2 text-sm">{n.categoria}</td>
                <td className="px-3 py-2 text-sm">
                  {(n.enderecoEntrega?.cidade || '')}/{(n.enderecoEntrega?.uf || '')}
                </td>
                <td className="px-3 py-2 text-sm">{n.status}</td>
                <td className="px-3 py-2 text-sm">{n.criadoEm?.slice(0, 10)}</td>
                <td className="px-3 py-2 text-sm text-right">
                  <RowActions id={n.id} onUpdate={onUpdate} onDelete={onDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t">
        <span className="text-xs text-gray-600">
          {total} registros • Página {page} de {pages}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={onPrev}>
            Anterior
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={onNext}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}