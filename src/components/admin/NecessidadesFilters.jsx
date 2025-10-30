import React from 'react';
import Button from '../Button';

export default function NecessidadesFilters({ value, onChange, onExport }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch, page: 1 });

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-end">
        <div className="flex-1">
          <label className="block text-sm text-gray-700 mb-1">Buscar</label>
          <input 
            className="border rounded-lg px-3 py-2 w-full" 
            placeholder="Nome, item, cidade..." 
            value={v.query || ''} 
            onChange={(e) => set({ query: e.target.value })} 
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Status</label>
          <select 
            className="border rounded-lg px-3 py-2" 
            value={v.status || ''} 
            onChange={(e) => set({ status: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="em_analise">Em análise</option>
            <option value="parcial">Parcial</option>
            <option value="atendida">Atendida</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Prioridade</label>
          <select 
            className="border rounded-lg px-3 py-2" 
            value={v.prioridade || ''} 
            onChange={(e) => set({ prioridade: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Categoria</label>
          <select 
            className="border rounded-lg px-3 py-2" 
            value={v.categoria || ''} 
            onChange={(e) => set({ categoria: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="alimento">Alimento</option>
            <option value="higiene">Higiene</option>
            <option value="vestuario">Vestuário</option>
            <option value="mobilia">Mobília</option>
            <option value="outros">Outros</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onExport}>Exportar CSV</Button>
        </div>
      </div>
    </div>
  );
}