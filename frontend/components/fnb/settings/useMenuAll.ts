import { useQuery } from '@tanstack/react-query';
import { fnbApi, fnbKeys } from '@/lib/fnb/api';

/** The whole menu, inactive rows included — what the settings screens edit. */
export function useMenuAll() {
  return useQuery({ queryKey: fnbKeys.menuAll, queryFn: fnbApi.menuAll, staleTime: 30_000 });
}
