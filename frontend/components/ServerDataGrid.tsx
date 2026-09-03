'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { DataGrid, type DataGridProps, type GridColDef, type GridValidRowModel } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

export interface ServerDataGridProps<R extends GridValidRowModel>
  extends Omit<
    DataGridProps<R>,
    'rows' | 'columns' | 'paginationMode' | 'rowCount' | 'paginationModel' | 'onPaginationModelChange' | 'loading'
  > {
  rows: R[];
  columns: GridColDef<R>[];
  rowCount: number;
  loading?: boolean;
  /** 1-based page (matches the API). */
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  emptyText?: string;
}

function EmptyOverlay({ text }: { text: string }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  );
}

/**
 * DataGrid pre-wired for server-side paging, glass styling and localized chrome.
 */
export default function ServerDataGrid<R extends GridValidRowModel>({
  rows,
  columns,
  rowCount,
  loading = false,
  page,
  pageSize,
  onPageChange,
  emptyText,
  sx,
  ...rest
}: ServerDataGridProps<R>) {
  const t = useTranslations('datagrid');
  const tc = useTranslations('common');
  const empty = emptyText ?? tc('noData');

  const localeText = useMemo(
    () => ({
      noRowsLabel: empty,
      noResultsOverlayLabel: empty,
      MuiTablePagination: {
        labelRowsPerPage: t('rowsPerPage'),
        labelDisplayedRows: ({ from, to, count }: { from: number; to: number; count: number }) =>
          t('displayedRows', { from, to, count: count === -1 ? to : count }),
      },
      columnMenuSortAsc: t('sortAsc'),
      columnMenuSortDesc: t('sortDesc'),
      columnMenuUnsort: t('unsort'),
      columnMenuHideColumn: t('hideColumn'),
      columnMenuManageColumns: t('manageColumns'),
      columnMenuFilter: t('filter'),
      columnsManagementShowHideAllText: t('showHideAll'),
      columnsManagementReset: t('reset'),
      columnsManagementSearchTitle: tc('search'),
      footerRowSelected: (count: number) => t('selected', { count }),
    }),
    [t, tc, empty],
  );

  return (
    <DataGrid<R>
      rows={rows}
      columns={columns}
      rowCount={rowCount}
      loading={loading}
      paginationMode="server"
      paginationModel={{ page: Math.max(0, page - 1), pageSize }}
      onPaginationModelChange={(m) => onPageChange(m.page + 1, m.pageSize)}
      pageSizeOptions={[25, 50, 100]}
      disableRowSelectionOnClick
      disableColumnFilter
      autoHeight
      localeText={localeText}
      slots={{ noRowsOverlay: () => <EmptyOverlay text={empty} /> }}
      sx={{
        border: (th) => `1px solid ${th.glass.border}`,
        borderRadius: (th) => `${th.glass.radius}px`,
        background: (th) => th.glass.surface,
        backdropFilter: (th) => th.glass.blur,
        '--DataGrid-containerBackground': 'transparent',
        '& .MuiDataGrid-columnHeaders': { borderBottom: (th) => `1px solid ${th.glass.border}` },
        '& .MuiDataGrid-columnHeader, & .MuiDataGrid-filler, & .MuiDataGrid-scrollbarFiller': {
          background: (th) => (th.palette.mode === 'dark' ? 'rgba(20, 40, 55, 0.95)' : 'rgba(240, 244, 255, 0.98)'),
        },
        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
        '& .MuiDataGrid-cell': { borderTop: (th) => `1px solid ${th.glass.border}`, display: 'flex', alignItems: 'center' },
        '& .MuiDataGrid-footerContainer': { borderTop: (th) => `1px solid ${th.glass.border}` },
        '& .MuiDataGrid-row:hover': { background: (th) => th.glass.surfaceStrong },
        '& .MuiDataGrid-row.row-clickable': { cursor: 'pointer' },
        '& .MuiDataGrid-overlayWrapperInner': { minHeight: 120 },
        ...sx,
      }}
      {...rest}
    />
  );
}
