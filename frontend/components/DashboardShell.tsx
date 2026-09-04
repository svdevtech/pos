'use client';

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupsIcon from '@mui/icons-material/Groups';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import KeyIcon from '@mui/icons-material/Key';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import Tooltip from '@mui/material/Tooltip';
import PersonIcon from '@mui/icons-material/Person';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SavingsIcon from '@mui/icons-material/Savings';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SettingsIcon from '@mui/icons-material/Settings';
import StorefrontIcon from '@mui/icons-material/Storefront';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import AppFooter from '@/components/AppFooter';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import type { Role } from '@/lib/auth/session';
import LanguageSwitcher from './LanguageSwitcher';
import { useSession } from './Providers';

export const DRAWER_WIDTH = 248;
/** Remembers whether the side menu is pinned open on wide screens. */
const SIDEBAR_KEY = 'pos.sidebarOpen';

type NavKey =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'inventory'
  | 'stockCheck'
  | 'suppliers'
  | 'promotions'
  | 'members'
  | 'ar'
  | 'expenses'
  | 'reports'
  | 'dividends'
  | 'settings'
  | 'ai'
  | 'stores'
  | 'help';

interface NavItem {
  key: NavKey;
  href: string;
  icon: ReactNode;
  /** Roles allowed to see the item; undefined = everyone. */
  roles?: readonly Role[];
}

const BACK_OFFICE: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'viewer'];
const SELLERS: readonly Role[] = ['platform_admin', 'store_owner', 'manager', 'cashier'];

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: <DashboardIcon /> },
  { key: 'pos', href: '/pos', icon: <PointOfSaleIcon />, roles: SELLERS },
  { key: 'products', href: '/products', icon: <Inventory2Icon />, roles: BACK_OFFICE },
  { key: 'inventory', href: '/inventory', icon: <WarehouseIcon />, roles: BACK_OFFICE },
  // stock lookup by scanning; cashiers need it on the shop floor too
  { key: 'stockCheck', href: '/inventory/check', icon: <QrCodeScannerIcon /> },
  { key: 'suppliers', href: '/suppliers', icon: <LocalShippingIcon />, roles: BACK_OFFICE },
  { key: 'promotions', href: '/promotions', icon: <LocalOfferIcon />, roles: BACK_OFFICE },
  { key: 'members', href: '/members', icon: <GroupsIcon />, roles: BACK_OFFICE },
  { key: 'ar', href: '/ar', icon: <AccountBalanceWalletIcon />, roles: BACK_OFFICE },
  { key: 'expenses', href: '/expenses', icon: <ReceiptLongIcon />, roles: BACK_OFFICE },
  { key: 'reports', href: '/reports', icon: <AssessmentIcon />, roles: BACK_OFFICE },
  { key: 'dividends', href: '/dividends', icon: <SavingsIcon />, roles: BACK_OFFICE },
  { key: 'ai', href: '/ai', icon: <AutoAwesomeIcon />, roles: BACK_OFFICE },
  { key: 'settings', href: '/settings', icon: <SettingsIcon />, roles: BACK_OFFICE },
  { key: 'help', href: '/help', icon: <MenuBookIcon /> },
];

const ADMIN_ITEMS: NavItem[] = [{ key: 'stores', href: '/admin/stores', icon: <StorefrontIcon />, roles: ['platform_admin'] }];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  const ts = useTranslations('settings');
  const ta = useTranslations('admin');
  const locale = useLocale();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { session, store, hasRole, isPlatformAdmin, logout, selectStore } = useSession();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // desktop: the menu can be hidden to give the page full width (remembered per device)
  const [desktopOpen, setDesktopOpen] = useState(true);
  useEffect(() => {
    try {
      setDesktopOpen(window.localStorage.getItem(SIDEBAR_KEY) !== '0');
    } catch {
      /* private mode */
    }
  }, []);
  const toggleDesktop = (open: boolean) => {
    setDesktopOpen(open);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
    } catch {
      /* private mode */
    }
  };

  const visible = (items: NavItem[]) => items.filter((i) => !i.roles || hasRole(...i.roles));
  const storeItems = isPlatformAdmin && !store ? [] : visible(NAV_ITEMS);
  const adminItems = visible(ADMIN_ITEMS);

  const storeName = store ? (locale === 'en' && store.name_en ? store.name_en : store.name) : null;
  const title = storeName ?? (isPlatformAdmin ? ta('title') : tc('appName'));

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <ListItemButton
        key={item.key}
        component={Link}
        href={item.href}
        selected={isActive(pathname, item.href)}
        onClick={() => setMobileOpen(false)}
      >
        <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>{item.icon}</ListItemIcon>
        <ListItemText primary={tn(item.key)} />
      </ListItemButton>
    ));

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 1.5 }}>
        <Avatar
          variant="rounded"
          sx={{ backgroundImage: (th) => th.glass.gradient, width: 36, height: 36, fontWeight: 700 }}
        >
          {tc('appName').slice(0, 1)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {tc('appName')}
          </Typography>
          {store && (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {store.code}
            </Typography>
          )}
        </Box>
        <Tooltip title={tn('hideMenu')}>
          <IconButton
            size="small"
            aria-label={tn('hideMenu')}
            onClick={() => (window.innerWidth < 900 ? setMobileOpen(false) : toggleDesktop(false))}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
      <Divider />
      <List sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        {adminItems.length > 0 && (
          <>
            <ListSubheader disableSticky sx={{ background: 'transparent' }}>
              {tn('admin')}
            </ListSubheader>
            {renderItems(adminItems)}
            {storeItems.length > 0 && <Divider sx={{ my: 1 }} />}
          </>
        )}
        {storeItems.length > 0 && (
          <>
            {adminItems.length > 0 && (
              <ListSubheader disableSticky sx={{ background: 'transparent' }}>
                {storeName}
              </ListSubheader>
            )}
            {renderItems(storeItems)}
          </>
        )}
      </List>
      <Divider />
      <List dense>
        <ListItemButton onClick={() => void logout()}>
          <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary={tn('logout')} />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', '@supports (min-height: 100dvh)': { minHeight: '100dvh' } }}>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <AppBar position="fixed" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          <Tooltip title={desktopOpen ? tn('hideMenu') : tn('openMenu')}>
            <IconButton
              color="inherit"
              edge="start"
              aria-label={desktopOpen ? tn('hideMenu') : tn('openMenu')}
              onClick={() => {
                if (window.innerWidth < 900) setMobileOpen((v) => !v);
                else toggleDesktop(!desktopOpen);
              }}
            >
              <MenuIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="h6" component="div" noWrap sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {isPlatformAdmin && store && (
            <Chip
              size="small"
              label={ta('exitStore')}
              onDelete={() => {
                selectStore(null);
                router.push('/admin/stores');
              }}
              onClick={() => {
                selectStore(null);
                router.push('/admin/stores');
              }}
              sx={{ ml: 1, background: 'rgba(255,255,255,0.12)', color: 'inherit' }}
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <LanguageSwitcher />
          {session && (
            <>
              <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" aria-label={tn('profile')} sx={{ ml: 0.5 }}>
                <Avatar sx={{ width: 34, height: 34, backgroundImage: (th) => th.glass.gradient, fontSize: 15 }}>
                  {session.user.display_name.slice(0, 1).toUpperCase()}
                </Avatar>
              </IconButton>
              <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography variant="subtitle2">{session.user.display_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    @{session.user.username} · {ts(`roles.${session.user.role}`)}
                  </Typography>
                </Box>
                <Divider />
                <MenuItem component={Link} href="/settings" onClick={() => setAnchor(null)}>
                  <ListItemIcon>
                    <PersonIcon fontSize="small" />
                  </ListItemIcon>
                  {tn('profile')}
                </MenuItem>
                <MenuItem component={Link} href="/settings/password" onClick={() => setAnchor(null)}>
                  <ListItemIcon>
                    <KeyIcon fontSize="small" />
                  </ListItemIcon>
                  {tn('changePassword')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setAnchor(null);
                    void logout();
                  }}
                >
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  {tn('logout')}
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { xs: 0, md: desktopOpen ? DRAWER_WIDTH : 0 }, flexShrink: { md: 0 }, transition: 'width 180ms ease' }}
        aria-label={tn('menu')}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: desktopOpen ? 'none' : 'block' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{ display: { xs: 'none', md: desktopOpen ? 'block' : 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          p: { xs: 2, md: 3 },
          width: { xs: '100%', md: desktopOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%' },
          transition: 'width 180ms ease',
        }}
      >
        <Toolbar />
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Box>
      </Box>
      <AppFooter />
    </Box>
  );
}
