import { useCallback, useEffect, useState } from 'react';

// Mock data para simular o comportamento até que o backend seja implementado
const mockNecessidades = [
  // Dados vazios por enquanto - será implementado quando o backend estiver pronto
];

export function useAdminNecessidades(initial = {}) {
  const [filters, setFilters] = useState({
    query: '',
    status: '',
    prioridade: '',
    categoria: '',
    page: 1,
    pageSize: 20,
    ...initial,
  });
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 20, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      // Simular loading
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Por enquanto, retornar dados vazios
      setItems([]);
      setMeta({ total: 0, page: 1, pageSize: 20, pages: 0 });
    } catch (e) {
      setError(e?.message || 'Erro');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { 
    fetchList(); 
  }, [fetchList]);

  const setPage = (p) => setFilters((f) => ({ ...f, page: p }));

  const updateStatus = async (id, patch) => {
    // Mock implementation - não faz nada por enquanto
    console.log('Atualizando necessidade:', id, patch);
    await fetchList();
  };

  const exportCsv = async () => {
    // Mock CSV export
    const csv = 'Nome,Item,Prioridade,Quantidade,Categoria,Status\n';
    return csv;
  };

  return {
    items,
    total: meta.total,
    page: meta.page,
    pageSize: meta.pageSize,
    pages: meta.pages,
    loading,
    error,
    filters,
    fetchList,
    setFilters,
    setPage,
    updateStatus,
    exportCsv,
  };
}

export default useAdminNecessidades;