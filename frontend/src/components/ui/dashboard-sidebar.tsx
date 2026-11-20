'use client';

import React, { useState } from 'react';
import {
  Search,
  LayoutDashboard,
  Warehouse,
  Map as MapIcon,
  Satellite,
  CloudSun,
  BrainCircuit,
  Sprout,
  Radio,
  FileBarChart,
  Users,
  CreditCard,
  Settings,
  LogOut,
  Hash,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  X,
} from 'lucide-react';

/**
 * AppSidebar (مبني على نمط shadcn/ui الأساسي).
 * مُقتبَس ومُطوَّع من مكوّن dashboard-sidebar القياسي الذي زوّدنا به المستخدم،
 * مع استبدال بيانات العرض التجريبية (Acme Corp / Projects / Team...) ببيانات
 * وحدات AgroCloud Vision الفعلية، ودعم اتجاه RTL للعربية.
 *
 * ملاحظة RTL: هذا المكوّن مبني أصلاً باتجاه LTR (كما في مكوّنات shadcn القياسية)،
 * لذلك يُغلَّف داخلياً بـ dir="ltr" لضمان ثبات شريط التمرير والأيقونات؛
 * بقية الصفحة (Topbar + المحتوى) تبقى RTL كما في باقي التطبيق.
 */

export type NavItemData = {
  id: string;
  title: string;
  icon: React.ElementType;
  badge?: number | string;
  shortcut?: string;
  children?: NavItemData[];
};

export type NavGroupData = {
  heading?: string;
  items: NavItemData[];
};

// ====== بيانات التنقّل الفعلية لمنصة AgroCloud Vision ======
export const agroCloudNavGroups: NavGroupData[] = [
  {
    items: [
      { id: 'search', title: 'بحث', icon: Search, shortcut: '⌘K' },
      { id: 'home', title: 'الرئيسية', icon: LayoutDashboard },
      { id: 'farms', title: 'المزارع', icon: Warehouse },
      {
        id: 'fields',
        title: 'الحقول والخرائط',
        icon: MapIcon,
        children: [
          { id: 'fields-boundaries', title: 'حدود الحقول', icon: Hash },
          { id: 'fields-zoning', title: 'تقسيم المناطق (Zoning)', icon: Hash },
        ],
      },
    ],
  },
  {
    heading: 'المراقبة والذكاء',
    items: [
      {
        id: 'satellite',
        title: 'الأقمار الصناعية',
        icon: Satellite,
        badge: 'قريباً',
        children: [
          { id: 'ndvi', title: 'NDVI', icon: Hash },
          { id: 'ndmi', title: 'NDMI', icon: Hash },
          { id: 'ndwi', title: 'NDWI', icon: Hash },
        ],
      },
      { id: 'weather', title: 'الطقس', icon: CloudSun },
      { id: 'ai-insights', title: 'الذكاء الاصطناعي', icon: BrainCircuit, badge: 'قريباً' },
    ],
  },
  {
    heading: 'العمليات الزراعية',
    items: [
      { id: 'operations', title: 'الأنشطة والعمليات', icon: Sprout },
      { id: 'iot', title: 'أجهزة IoT', icon: Radio, badge: 'قريباً' },
      { id: 'reports', title: 'التقارير', icon: FileBarChart },
    ],
  },
  {
    heading: 'المؤسسة',
    items: [
      {
        id: 'team',
        title: 'الفريق والصلاحيات',
        icon: Users,
        children: [
          { id: 'team-members', title: 'الأعضاء', icon: Hash },
          { id: 'team-roles', title: 'الأدوار (RBAC)', icon: Hash },
        ],
      },
      { id: 'billing', title: 'الاشتراك والفوترة', icon: CreditCard, badge: 'قريباً' },
    ],
  },
];

export const agroCloudBottomItems: NavItemData[] = [
  { id: 'settings', title: 'الإعدادات', icon: Settings, shortcut: '⌘,' },
  { id: 'logout', title: 'تسجيل الخروج', icon: LogOut },
];

function WorkspaceSwitcher({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect?: (ws: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalSelected, setInternalSelected] = useState('مزرعة الوادي الأخضر');

  const current = selected || internalSelected;
  const handleSelect = onSelect || setInternalSelected;

  return (
    <div className="relative">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-2 py-2 mb-4 rounded-lg hover:bg-white/5 cursor-pointer transition-colors select-none group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[6px] bg-primary text-primary-foreground flex items-center justify-center font-semibold text-[13px] shadow-sm">
            {current.charAt(0)}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-[13px] font-medium leading-none mb-1 text-foreground truncate max-w-[130px]">
              {current}
            </span>
            <span className="text-[11px] text-muted-foreground leading-none">الخطة الاحترافية</span>
          </div>
        </div>
        <ChevronDown
          className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors shrink-0"
          strokeWidth={1.5}
        />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-[52px] left-0 w-full bg-card border border-border/50 rounded-lg shadow-xl z-50 py-1 flex flex-col gap-0.5">
            {['مزرعة الوادي الأخضر', 'مزرعة النخيل الذهبي', 'مزرعة دلتا الحصاد'].map((ws) => (
              <div
                key={ws}
                onClick={() => {
                  handleSelect(ws);
                  setIsOpen(false);
                }}
                className={`px-3 py-2 mx-1 text-[13px] rounded-md cursor-pointer transition-colors ${
                  current === ws ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-white/5'
                }`}
              >
                {ws}
              </div>
            ))}
            <div className="h-px bg-border/50 my-1 mx-2" />
            <div className="px-3 py-2 mx-1 text-[13px] text-muted-foreground hover:bg-white/5 rounded-md cursor-pointer flex items-center gap-2 transition-colors">
              <span className="text-[16px] leading-none mb-0.5">+</span> إضافة مزرعة جديدة
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NavItem({
  item,
  activeId,
  onSelect,
  level = 0,
}: {
  item: NavItemData;
  activeId: string;
  onSelect: (id: string) => void;
  level?: number;
}) {
  const isActive = activeId === item.id;
  const hasChildren = !!item.children;
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = () => {
    if (hasChildren) {
      setIsOpen(!isOpen);
    } else {
      onSelect(item.id);
    }
  };

  return (
    <div className="flex flex-col w-full">
      <div
        className={`group flex items-center justify-between px-2.5 py-[7px] rounded-[6px] cursor-pointer transition-all duration-200 select-none
          ${isActive ? 'bg-white/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/90'}
        `}
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        onClick={handleClick}
      >
        <div className="flex items-center gap-2.5">
          <item.icon
            className={`w-[16px] h-[16px] transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground/70 group-hover:text-foreground/70'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[13px] tracking-wide truncate">{item.title}</span>
        </div>

        <div className="flex items-center gap-2">
          {item.shortcut && (
            <kbd className="hidden group-hover:inline-flex items-center justify-center h-5 px-1.5 text-[10px] font-medium font-mono text-muted-foreground/60 bg-background/50 border border-border/50 rounded-[4px]">
              {item.shortcut}
            </kbd>
          )}
          {item.badge && (
            <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary whitespace-nowrap">
              {item.badge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
              strokeWidth={2}
            />
          )}
        </div>
      </div>

      {hasChildren && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden min-h-0 relative flex flex-col gap-0.5 mt-0.5">
            <div
              className="absolute top-0 bottom-0 border-l border-white/5"
              style={{ left: `${level * 12 + 17.5}px` }}
            />
            {item.children!.map((child) => (
              <NavItem key={child.id} item={child} activeId={activeId} onSelect={onSelect} level={level + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SidebarNav({
  className = '',
  groups = agroCloudNavGroups,
  bottomItems = agroCloudBottomItems,
  activeId,
  onSelect,
  activeWorkspace,
  onWorkspaceSelect,
}: {
  className?: string;
  groups?: NavGroupData[];
  bottomItems?: NavItemData[];
  activeId?: string;
  onSelect?: (id: string) => void;
  activeWorkspace?: string;
  onWorkspaceSelect?: (ws: string) => void;
}) {
  const [internalId, setInternalId] = useState('home');
  const currentId = activeId !== undefined ? activeId : internalId;
  const handleSelect = onSelect || setInternalId;

  return (
    <div
      dir="ltr"
      className={`flex flex-col w-[260px] h-full bg-[#0f1d16] border-r border-white/5 p-3 font-sans text-foreground ${className}`}
      style={{ ['--foreground' as any]: '150 10% 92%', ['--muted-foreground' as any]: '150 6% 60%' }}
    >
      <WorkspaceSwitcher selected={activeWorkspace} onSelect={onWorkspaceSelect} />

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden flex flex-col gap-4 mt-2">
        {groups.map((group, idx) => (
          <div key={idx} className="flex flex-col gap-0.5">
            {group.heading && (
              <span className="px-2.5 mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/50 uppercase">
                {group.heading}
              </span>
            )}
            {group.items.map((item) => (
              <NavItem key={item.id} item={item} activeId={currentId} onSelect={handleSelect} />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4 border-t border-white/5 flex flex-col gap-0.5">
        {bottomItems.map((item) => (
          <NavItem key={item.id} item={item} activeId={currentId} onSelect={handleSelect} />
        ))}
      </div>
    </div>
  );
}

/**
 * AppShell: يجمع SidebarNav مع شريط علوي وزر طيّ، جاهز للاستخدام مباشرة
 * في أي صفحة من صفحات لوحة التحكم (Dashboard, FarmDetail, ...).
 */
export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeId, setActiveId] = useState('home');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleSelect = (id: string) => {
    if (id === 'search') {
      setIsSearchOpen(true);
      return;
    }
    setActiveId(id);
  };

  return (
    <div className="relative flex h-screen w-full bg-[#f4f7f5]">
      <div
        className={`h-full transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
          isOpen ? 'w-[260px] opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <SidebarNav activeId={activeId} onSelect={handleSelect} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b border-black/5 flex items-center px-4 justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-1.5 rounded-md text-gray-500 hover:bg-black/5 hover:text-gray-900 transition-colors"
            >
              {isOpen ? (
                <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.5} />
              ) : (
                <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.5} />
              )}
            </button>
            <span className="text-sm font-medium text-gray-800">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 border border-emerald-200" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>

      {isSearchOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm px-4">
          <div className="absolute inset-0" onClick={() => setIsSearchOpen(false)} />
          <div className="relative w-full max-w-xl bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center px-4 border-b border-gray-100">
              <Search className="w-[18px] h-[18px] text-gray-400 ml-3 shrink-0" strokeWidth={1.5} />
              <input
                autoFocus
                className="flex-1 bg-transparent py-4 outline-none text-[14px] text-gray-800 placeholder:text-gray-400"
                placeholder="ابحث عن مزرعة، حقل، أو إجراء..."
              />
              <button
                onClick={() => setIsSearchOpen(false)}
                className="mr-1 p-1 rounded-md text-gray-400 hover:bg-black/5 hover:text-gray-700 transition-colors"
              >
                <X className="w-[18px] h-[18px]" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-2 py-8 flex flex-col items-center justify-center">
              <Command className="w-6 h-6 text-gray-300 mb-2" strokeWidth={1.5} />
              <p className="text-[13px] text-gray-500 font-medium">اكتب أمراً أو ابحث...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
