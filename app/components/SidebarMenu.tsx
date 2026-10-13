import { useState } from "react";
import { Link, useLocation, useNavigate } from "@remix-run/react";
import {
  Users,
  Fingerprint,
  FileText,
  Package,
  Receipt,
  BarChart3,
  LayoutDashboard,
  UserCog,
  RefreshCw,
  UserMinus,
  History,
  Download,
  HelpCircle,
  Loader2,
  ChevronRight,
  LucideProps,
} from "lucide-react";

import { cn } from "../lib/utils";
import { menuItems, MenuItem } from "../config/menuItems";
import { useLoading } from "./LoadingProvider";
import { useSidebar } from "./ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface SidebarMenuProps {
  userRole?: string;
}

// Map string icon keys from your menuItems config to Lucide React components
function DynamicIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const props: LucideProps = { className };

  switch (name) {
    case "users":
      return <Users {...props} />;
    case "fingerprint":
      return <Fingerprint {...props} />;
    case "file-text":
      return <FileText {...props} />;
    case "package":
      return <Package {...props} />;
    case "receipt":
      return <Receipt {...props} />;
    case "chart-no-axes-combined":
      return <BarChart3 {...props} />;
    case "layout-dashboard":
      return <LayoutDashboard {...props} />;
    case "user-cog":
      return <UserCog {...props} />;
    case "refresh-cw":
      return <RefreshCw {...props} />;
    case "user-minus":
      return <UserMinus {...props} />;
    case "history":
      return <History {...props} />;
    case "download":
      return <Download {...props} />;
    default:
      return <HelpCircle {...props} />;
  }
}

export default function SidebarMenu({ userRole }: SidebarMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const [isNavigating, setIsNavigating] = useState(false);
  const { showSummaryLoading } = useLoading();

  const handleSummaryClick = () => {
    if (isNavigating) return;
    setIsNavigating(true);
    showSummaryLoading();
    navigate("/new-summary");
  };

  // Filter items based on user role permissions
  const visibleItems = menuItems.filter((item) => {
    if (item.adminOnly && userRole !== "admin") return false;
    if (item.cpHidden && userRole === "cp") return false;
    return true;
  });

  // Group visible items by their `section` property
  const groupedItems = visibleItems.reduce<Record<string, MenuItem[]>>(
    (acc, item) => {
      const section = item.section ?? "General";
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    },
    {},
  );

  const renderMenuItem = (item: MenuItem) => {
    const correctPath =
      userRole === "cp" && item.cpPath ? item.cpPath : item.path;
    const isActive = location.pathname === correctPath;
    const isSummary = item.path === "/new-summary";

    // Disabled Item rendering
    if (item.disabled) {
      const disabledContent = (
        <div
          className={cn(
            "flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-gray-400 opacity-50 dark:text-gray-600",
            isCollapsed && "justify-center px-2",
          )}
        >
          <DynamicIcon name={item.icon} className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="truncate">{item.name}</span>}
        </div>
      );

      return isCollapsed ? (
        <Tooltip key={item.path}>
          <TooltipTrigger asChild>{disabledContent}</TooltipTrigger>
          <TooltipContent side="right">{item.name} (Disabled)</TooltipContent>
        </Tooltip>
      ) : (
        disabledContent
      );
    }

    const buttonClass = cn(
      "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 outline-none",
      isActive
        ? "bg-[#137B78]/10 text-[#137B78] dark:bg-[#137B78]/20 dark:text-[#65C5BF] font-semibold"
        : "text-gray-600 hover:bg-[#137B78]/10 hover:text-[#137B78] dark:text-gray-400 dark:hover:bg-[#137B78]/15 dark:hover:text-[#65C5BF]",
      isCollapsed && "justify-center px-2",
    );

    // Summary button (interactive trigger with loading state)
    if (isSummary) {
      const summaryBtn = (
        <button
          key={item.path}
          type="button"
          onClick={handleSummaryClick}
          disabled={isNavigating}
          aria-current={isActive ? "page" : undefined}
          className={cn(buttonClass, isNavigating && "opacity-70")}
        >
          {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-emerald-600 dark:bg-emerald-400" />
          )}

          <DynamicIcon
            name={item.icon}
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              isActive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-gray-400 group-hover:text-emerald-600 dark:text-gray-500 dark:group-hover:text-emerald-400",
            )}
          />

          {!isCollapsed && (
            <span className="min-w-0 flex-1 text-left truncate">
              {item.name}
            </span>
          )}

          {isNavigating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />
          ) : (
            !isCollapsed && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
            )
          )}
        </button>
      );

      return isCollapsed ? (
        <Tooltip key={item.path}>
          <TooltipTrigger asChild>{summaryBtn}</TooltipTrigger>
          <TooltipContent side="right">{item.name}</TooltipContent>
        </Tooltip>
      ) : (
        summaryBtn
      );
    }

    // Standard Link Item
    const linkItem = (
      <Link
        key={item.path}
        to={correctPath}
        aria-current={isActive ? "page" : undefined}
        className={buttonClass}
      >
        {isActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-emerald-600 dark:bg-emerald-400" />
        )}

        <DynamicIcon
          name={item.icon}
          className={cn(
            "h-4 w-4 shrink-0 transition-colors duration-200",
            isActive
              ? "text-[#137B78] dark:text-[#65C5BF]"
              : "text-gray-500 group-hover:text-[#137B78] dark:text-gray-400 dark:group-hover:text-[#65C5BF]",
          )}
        />

        {!isCollapsed && (
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
        )}
      </Link>
    );

    return isCollapsed ? (
      <Tooltip key={item.path}>
        <TooltipTrigger asChild>{linkItem}</TooltipTrigger>
        <TooltipContent side="right">{item.name}</TooltipContent>
      </Tooltip>
    ) : (
      linkItem
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex flex-col gap-4 px-2">
        {Object.entries(groupedItems).map(([sectionTitle, items]) => (
          <div key={sectionTitle} className="flex flex-col gap-1">
            {/* Section Header */}
            {!isCollapsed && (
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                {sectionTitle}
              </p>
            )}

            {/* Section Items */}
            {items.map((item) => renderMenuItem(item))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}
