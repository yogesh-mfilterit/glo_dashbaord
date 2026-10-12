import { Link, useLocation, useNavigate } from "@remix-run/react";
import { cn } from "../lib/utils";
import { menuItems } from "../config/menuItems";
import { useState } from "react";
import { useLoading } from "./LoadingProvider";

interface SidebarMenuProps {
  userRole?: string;
}

export default function SidebarMenu({ userRole }: SidebarMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isNavigating, setIsNavigating] = useState(false);
  const { showSummaryLoading } = useLoading();

  const handleSummaryClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsNavigating(true);
    
    // Show loading immediately using the context
    showSummaryLoading();
    
    // Show immediate visual feedback
    document.body.style.cursor = 'wait';
    
    // Navigate to summary
    navigate('/summary');
    
    // Reset cursor after navigation
    setTimeout(() => {
      document.body.style.cursor = 'default';
      setIsNavigating(false);
    }, 100);
  };

  return (
    <nav className="flex flex-col gap-1">
      {menuItems.map((item) => {
        // Hide admin-only items for non-admin users
        if (item.adminOnly && userRole !== "admin") return null;
        
        // Hide items from CP users when cpHidden is true
        if (item.cpHidden && userRole === "cp") return null;
        
        // Handle disabled items
        if (item.disabled) {
          return (
            <button
              key={item.path}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-not-allowed opacity-50",
                "bg-gray-100/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400",
                "hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
              disabled
              type="button"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
              {item.name}
            </button>
          );
        }

        // Determine the correct path based on user role
        const correctPath = userRole === "cp" && item.cpPath ? item.cpPath : item.path;
        const isActive = location.pathname === correctPath;

        // Special handling for Summary menu item
        if (item.path === "/summary") {
          return (
            <button
              key={item.path}
              onClick={handleSummaryClick}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                "hover:bg-gray-100/80 dark:hover:bg-gray-800/80",
                "hover:text-gray-900 dark:hover:text-white",
                isActive 
                  ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50" 
                  : "text-gray-700 dark:text-gray-300",
                isNavigating && "bg-blue-100 dark:bg-blue-900/50"
              )}
              disabled={isNavigating}
            >
              <div className={cn(
                "w-1.5 h-1.5 rounded-full transition-all duration-200",
                isActive 
                  ? "bg-blue-500 dark:bg-blue-400" 
                  : "bg-gray-400 dark:bg-gray-500 group-hover:bg-gray-600 dark:group-hover:bg-gray-400"
              )} />
              {item.name}
              {isNavigating && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              )}
              {isActive && (
                <div className="absolute inset-y-0 left-0 w-0.5 bg-blue-500 dark:bg-blue-400 rounded-r-full" />
              )}
            </button>
          );
        }

        // Render other menu items normally
        return (
          <Link
            key={item.path}
            to={correctPath}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              "hover:bg-gray-100/80 dark:hover:bg-gray-800/80",
              "hover:text-gray-900 dark:hover:text-white",
              isActive 
                ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50" 
                : "text-gray-700 dark:text-gray-300"
            )}
          >
            <div className={cn(
              "w-1.5 h-1.5 rounded-full transition-all duration-200",
              isActive 
                ? "bg-blue-500 dark:bg-blue-400" 
                : "bg-gray-400 dark:bg-gray-500 group-hover:bg-gray-600 dark:group-hover:bg-gray-400"
            )} />
            {item.name}
            {isActive && (
              <div className="absolute inset-y-0 left-0 w-0.5 bg-blue-500 dark:bg-blue-400 rounded-r-full" />
            )}
          </Link>
        );
      })}
    </nav>
  );
} 