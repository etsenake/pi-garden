import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { SearchIcon } from "../ui/icons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/shadcn/input-group";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/ui/shadcn/sidebar";

const SECONDARY_SIDEBAR_STYLE = { "--sidebar-width": "248px" } as CSSProperties;

export interface SecondarySurfaceNavItem {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly icon: ReactNode;
  /** Extra search terms, such as the titles of the rows on that page. */
  readonly keywords: readonly string[];
}

interface SecondarySurfaceProps {
  readonly title: string;
  readonly onBack: () => void;
  readonly navItems?: readonly SecondarySurfaceNavItem[];
  readonly activeNavId?: string;
  readonly onSelectNav?: (id: string) => void;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function SecondarySurface({
  title,
  onBack,
  navItems = [],
  activeNavId,
  onSelectNav,
  testId,
  children,
}: SecondarySurfaceProps) {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat)
        return;
      // Nested dialogs own Escape, including while a pending operation disables dismissal.
      if (document.querySelector("[aria-modal='true'], .extension-dialog-backdrop")) return;
      event.preventDefault();
      backRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const [query, setQuery] = useState("");
  const matches = filterNavItems(navItems, query);

  // Each nav page starts at its top, as in Codex, instead of inheriting the last page's scroll.
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeNavId]);

  return (
    // A fixed nav column: the Sidebar never collapses here, so the provider's
    // open state (and its Cmd/Ctrl+B listener) has nothing to drive.
    <SidebarProvider
      className="secondary-surface"
      data-testid={testId}
      style={SECONDARY_SIDEBAR_STYLE}
    >
      <Sidebar
        className="secondary-surface__sidebar max-[700px]:w-42"
        collapsible="none"
        role="complementary"
      >
        <SidebarHeader className="pt-(--titlebar-inset-top)">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton data-testid="secondary-surface-back" onClick={onBack}>
                <ArrowLeftIcon aria-hidden="true" />
                <span>Back to app</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {navItems.length > 0 ? (
            <SecondarySurfaceSearch
              label={`Search ${title.toLowerCase()}`}
              query={query}
              onQueryChange={setQuery}
              onSubmit={() => {
                if (matches[0]) onSelectNav?.(matches[0].id);
              }}
            />
          ) : null}
        </SidebarHeader>
        <SidebarContent>
          {navItems.length > 0 ? (
            <SecondarySurfaceNav
              activeNavId={activeNavId}
              items={matches}
              label={`${title} sections`}
              query={query}
              onSelect={(id) => onSelectNav?.(id)}
            />
          ) : (
            <SidebarGroup>
              <SidebarGroupLabel className="secondary-surface__title">{title}</SidebarGroupLabel>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="secondary-surface__content" ref={contentRef}>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

function SecondarySurfaceSearch({
  label,
  query,
  onQueryChange,
  onSubmit,
}: {
  readonly label: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        placeholder="Search"
        spellCheck={false}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && query.trim()) onSubmit();
          // The first Escape clears the search; the next one leaves the surface.
          if (event.key === "Escape" && query) {
            event.preventDefault();
            onQueryChange("");
          }
        }}
      />
    </InputGroup>
  );
}

function SecondarySurfaceNav({
  items,
  activeNavId,
  label,
  query,
  onSelect,
}: {
  readonly items: readonly SecondarySurfaceNavItem[];
  readonly activeNavId?: string;
  readonly label: string;
  readonly query: string;
  readonly onSelect: (id: string) => void;
}) {
  const groups = [...new Set(items.map((item) => item.group))];
  return (
    <nav aria-label={label} className="secondary-surface__nav">
      {groups.map((group) => (
        <SidebarGroup className="secondary-surface__nav-group" key={group}>
          <SidebarGroupLabel>{group}</SidebarGroupLabel>
          <SidebarMenu>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    aria-current={activeNavId === item.id ? "page" : undefined}
                    isActive={activeNavId === item.id}
                    onClick={() => onSelect(item.id)}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
      {items.length === 0 ? (
        <SidebarGroup>
          <p className="secondary-surface__nav-empty px-2 text-sm">
            No matches for “{query.trim()}”
          </p>
        </SidebarGroup>
      ) : null}
    </nav>
  );
}

function filterNavItems(
  items: readonly SecondarySurfaceNavItem[],
  query: string,
): readonly SecondarySurfaceNavItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const haystack = [item.title, item.group, ...item.keywords].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
