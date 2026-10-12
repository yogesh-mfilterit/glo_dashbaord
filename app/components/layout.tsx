import { ReactNode } from 'react';
import { Link, useNavigation } from '@remix-run/react';
import { Button } from './ui/button';
import { SidebarProvider, Sidebar, SidebarContent, SidebarTrigger, useSidebar } from './ui/sidebar';
import SidebarMenu from './SidebarMenu';
import PasswordChangeModal from './PasswordChangeModal';
import { Loader2 } from 'lucide-react';

function FloatingSidebarTrigger() {
  const { state, toggleSidebar } = useSidebar();
  if (state !== 'collapsed') return null;
  return (
    <button
      onClick={toggleSidebar}
      className="fixed top-6 left-4 z-50 bg-white/80 backdrop-blur-sm dark:bg-gray-900/80 rounded-xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:bg-white dark:hover:bg-gray-900 transition-all duration-200 p-3"
      aria-label="Open menu"
    >
      {/* Modern hamburger icon */}
      <svg
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-700 dark:text-gray-300"
      >
        <line x1="4" y1="6" x2="16" y2="6" />
        <line x1="4" y1="12" x2="16" y2="12" />
        <line x1="4" y1="18" x2="16" y2="18" />
      </svg>
    </button>
  );
}

export default function Layout({
  children,
  userRole,
  userEmail,
}: {
  children: ReactNode;
  userRole?: string;
  userEmail?: string;
}) {
  const navigation = useNavigation();
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Top Navbar */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-16 items-center justify-between bg-white/80 backdrop-blur-xl dark:bg-gray-900/80 border-b border-gray-200/50 dark:border-gray-800/50 px-6">
        <div className="flex items-center gap-3">
          <img src="/mfilter-logo.webp" alt="mFilterIt Logo" className="h-8 w-auto" />
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">MTN Nigeria</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {userRole === 'admin'
                ? 'Administrator'
                : userRole === 'operations'
                  ? 'Operations'
                  : 'Content Partner'}
            </span>
          </div>
          {userEmail && <PasswordChangeModal userEmail={userEmail} />}
          <Button
            variant="ghost"
            asChild
            className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            <Link to="/logout">Logout</Link>
          </Button>
        </div>
      </header>

      <SidebarProvider>
        <FloatingSidebarTrigger />
        <div className="flex flex-1 pt-16">
          <Sidebar className="bg-white/80 backdrop-blur-xl dark:bg-gray-900/80 border-r border-gray-200/50 dark:border-gray-800/50 flex flex-col py-6 px-4">
            <div className="flex items-center justify-center mb-8">
              <img src="/mutli-sub-footer-logo.png" alt="MTN Logo" className="h-10 w-auto" />
            </div>
            <SidebarTrigger className="mb-6 self-end" />
            <SidebarContent>
              <SidebarMenu userRole={userRole} />
            </SidebarContent>
          </Sidebar>
          <main className="flex-1 box-border w-[calc(100vw-16rem)] ">
            {navigation.state === 'loading' ? (
              <div className="bg-gray-50 box-border w-full h-full flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-purple-500 animate-spin" />{' '}
              </div>
            ) : (
              <div className="p-6 pt-6 w-full">{children}</div>
            )}
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}
