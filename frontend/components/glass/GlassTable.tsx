'use client';

import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import type { ReactNode } from 'react';

export interface GlassColumn<T> {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render?: (row: T, index: number) => ReactNode;
}

export interface GlassTableProps<T> {
  columns: GlassColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  emptyText?: ReactNode;
  maxHeight?: number | string;
  size?: 'small' | 'medium';
  onRowClick?: (row: T) => void;
  /** Optional per-row selected state. */
  isSelected?: (row: T) => boolean;
}

const Container = styled(TableContainer)(({ theme }) => ({
  background: theme.glass.surface,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  border: `1px solid ${theme.glass.border}`,
  borderRadius: theme.glass.radius,
  overflow: 'auto',
}));

function cellValue<T>(row: T, key: string): ReactNode {
  const v = (row as Record<string, unknown>)[key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? '✓' : '';
  return String(v);
}

export default function GlassTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyText = '-',
  maxHeight = 520,
  size = 'small',
  onRowClick,
  isSelected,
}: GlassTableProps<T>) {
  return (
    <Container sx={{ maxHeight }}>
      <Table stickyHeader size={size}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col.key} align={col.align} sx={{ width: col.width }}>
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                <CircularProgress size={24} />
              </TableCell>
            </TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {emptyText}
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {!loading &&
            rows.map((row, index) => (
              <TableRow
                key={rowKey(row, index)}
                hover={Boolean(onRowClick)}
                selected={isSelected?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} align={col.align}>
                    {col.render ? col.render(row, index) : cellValue(row, col.key)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Container>
  );
}
