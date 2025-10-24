import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { adminApi } from '../services/adminApi';
import { NecessidadesListResponse, NecessidadeSchema } from '../types/adminSchemas';

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
      const res = await adminApi.necessidades(filters);
      const parsed = NecessidadesListResponse.safeParse(res);
      if (!parsed.success) {
        console.error('[useAdminNecessidades] contrato violado', parsed.error);
        setError('Dados inesperados (contrato violado)');
        return;
      }
      setItems(parsed.data.items);
      setMeta({ total: parsed.data.total, page: parsed.data.page, pageSize: parsed.data.pageSize, pages: parsed.data.pages });
    } catch (e) {
      setError(e?.message || 'Erro');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const setPage = (p) => setFilters((f) => ({ ...f, page: p }));

  const updateStatus = async (id, patch) => {
    await adminApi.patchNecessidade(id, patch);
    await fetchList();
  };

  const exportCsv = async () => {
    const csv = await adminApi.exportNecessidades(filters);
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
