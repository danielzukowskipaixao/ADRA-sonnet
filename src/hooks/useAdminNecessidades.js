import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../services/adminApi';

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
      const response = await adminApi.necessidades(filters);
      setItems(response.items || []);
      setMeta({
        total: response.total || 0,
        page: response.page || 1,
        pageSize: response.pageSize || 20,
        pages: response.pages || 0
      });
    } catch (e) {
      setError(e?.message || 'Erro ao carregar necessidades');
      console.error('Erro ao buscar necessidades:', e);
      // Em caso de erro, manter dados vazios
      setItems([]);
      setMeta({ total: 0, page: 1, pageSize: 20, pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { 
    fetchList(); 
  }, [fetchList]);

  const setPage = (p) => setFilters((f) => ({ ...f, page: p }));

  const updateStatus = async (id, patch) => {
    try {
      await adminApi.updateNecessidade(id, patch);
      // Recarrega a lista após atualização
      await fetchList();
    } catch (e) {
      console.error('Erro ao atualizar necessidade:', e);
      throw e;
    }
  };

  const exportCsv = async () => {
    try {
      return await adminApi.exportNecessidades();
    } catch (e) {
      console.error('Erro ao exportar CSV:', e);
      throw e;
    }
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