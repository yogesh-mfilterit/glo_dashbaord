import { ReactNode } from "react";
import { Link, useNavigation } from "@remix-run/react";
import { Loader2, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "./ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  useSidebar,
} from "./ui/sidebar";

import SidebarMenu from "./SidebarMenu";
import PasswordChangeModal from "./PasswordChangeModal";

interface LayoutProps {
  children: ReactNode;
  userRole?: string;
  userEmail?: string;
}

function DashboardHeader({
  userRole,
  userEmail,
}: {
  userRole?: string;
  userEmail?: string;
}) {
  const { state, toggleSidebar } = useSidebar();

  const roleLabel =
    userRole === "admin"
      ? "Administrator"
      : userRole === "operations"
      ? "Operations"
      : "Content Partner";

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/95 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={
            state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"
          }
          className="
    shrink-0 rounded-xl
    text-[#137B78]
    hover:bg-[#137B78]/10
    hover:text-[#137B78]
    dark:text-[#65C5BF]
    dark:hover:bg-[#137B78]/20
    dark:hover:text-[#65C5BF]
    transition-colors duration-200
  "
        >
          {state === "collapsed" ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </Button>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            Glo Nigeria
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Management Portal
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {roleLabel}
        </span>

        {userEmail && <PasswordChangeModal userEmail={userEmail} />}

        <Button
          variant="ghost"
          asChild
          className="rounded-xl text-gray-600 hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-950/30"
        >
          <Link to="/logout">
            <LogOut size={16} className="mr-2" />
            Logout
          </Link>
        </Button>
      </div>
    </header>
  );
}

export default function Layout({ children, userRole, userEmail }: LayoutProps) {
  const navigation = useNavigation();

  return (
    <div className="min-h-screen p-0 dark:bg-gray-950 sm:p-3 lg:p-5">
      <SidebarProvider
        defaultOpen={true}
        style={
          {
            // Set collapsed sidebar icon width precisely around 70px (4.5rem = 72px)
            "--sidebar-width-icon": "4.5rem",
          } as React.CSSProperties
        }
      >
        {/* Outer container with rounded corners and hidden overflow to clip inner contents cleanly */}
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-[1600px] overflow-hidden bg-white dark:bg-gray-900 sm:rounded-[28px]">
          {/* Enhanced Sidebar with Compact Collapsed Rail (~70px) */}
          <Sidebar
            collapsible="icon"
            className="border-r border-gray-100 bg-[#fafafa] dark:border-gray-800 dark:bg-gray-900 flex flex-col justify-between transition-all duration-200 group-data-[collapsible=icon]:w-[72px] sm:rounded-l-[27px]"
          >
            <div>
              {/* Logo Header Container */}
              <div className="flex h-[84px] shrink-0 items-center justify-center px-4 transition-all duration-200 border-b border-gray-100/60 dark:border-gray-800/60 group-data-[collapsible=icon]:px-1">
                <img
                  src="/mfilter-logo.webp"
                  alt="mFilterIt Logo"
                  className="h-9 w-auto max-w-[140px] object-contain transition-all duration-200 group-data-[collapsible=icon]:h-7 group-data-[collapsible=icon]:w-7 group-data-[collapsible=icon]:max-w-none group-data-[collapsible=icon]:object-cover group-data-[collapsible=icon]:object-left"
                />
              </div>

              {/* Sidebar Content */}
              <SidebarContent className="px-1 py-4">
                <SidebarMenu userRole={userRole} />
              </SidebarContent>
            </div>

            {/* Compact Bottom Account Card */}
            <div className="border-t border-gray-100 p-3 dark:border-gray-800/60 group-data-[collapsible=icon]:p-2 mt-auto">
              <div className="flex items-center gap-3 rounded-xl bg-white p-2.5 shadow-sm border border-gray-100 dark:border-gray-800 dark:bg-gray-800/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold dark:bg-emerald-950 dark:text-emerald-200">
                  {userEmail ? userEmail.charAt(0).toUpperCase() : "U"}
                </div>
                <div className="group-data-[collapsible=icon]:hidden min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                    {userEmail ?? "User"}
                  </p>
                  <p className="truncate text-[11px] capitalize text-gray-500 dark:text-gray-400">
                    {userRole ?? "Guest"}
                  </p>
                </div>
              </div>
            </div>
          </Sidebar>

          {/* Main Workspace Area */}
          <div
            className="
    relative z-0
    flex min-h-0 min-w-0 flex-1 flex-col
    rounded-2xl
    bg-[#f7f8f7]
    p-3
    dark:bg-gray-950
    sm:m-2 sm:ml-0
    sm:rounded-[24px]
    sm:p-4
    lg:p-5
  "
          >
            <DashboardHeader userRole={userRole} userEmail={userEmail} />

            <main className="min-w-0 flex-1 pt-5">
              {navigation.state === "loading" ? (
                <div className="flex min-h-[50vh] items-center justify-center rounded-2xl bg-white dark:bg-gray-900">
                  <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
                </div>
              ) : (
                <div className="min-w-0">{children}</div>
              )}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
