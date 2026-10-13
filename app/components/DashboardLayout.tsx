import { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

interface DashboardLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function DashboardLayout({
  children,
  title,
  description,
  actions,
  className,
}: DashboardLayoutProps) {
  return (
    <div className={`w-full min-w-0 ${className ?? ""}`}>
      {(title || description || actions) && (
        <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-3xl">
                {title}
              </h1>
            )}

            {description && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400 sm:text-base">
                {description}
              </p>
            )}
          </div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              {actions}
            </div>
          )}
        </header>
      )}

      <div className="min-w-0 space-y-6">
        {children}
      </div>
    </div>
  );
}

interface DashboardCardProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function DashboardCard({
  children,
  title,
  description,
  className,
}: DashboardCardProps) {
  return (
    <Card
      className={`min-w-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 ${className ?? ""}`}
    >
      {(title || description) && (
        <CardHeader className="space-y-1.5 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          {title && (
            <CardTitle className="text-base font-semibold tracking-tight text-gray-900 dark:text-white sm:text-lg">
              {title}
            </CardTitle>
          )}

          {description && (
            <CardDescription className="text-sm leading-5 text-gray-500 dark:text-gray-400">
              {description}
            </CardDescription>
          )}
        </CardHeader>
      )}

      <CardContent
        className={`px-5 pb-5 sm:px-6 sm:pb-6 ${
          title || description
            ? "pt-0"
            : "pt-5 sm:pt-6"
        }`}
      >
        {children}
      </CardContent>
    </Card>
  );
}

interface DashboardSectionProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function DashboardSection({
  children,
  title,
  description,
  className,
}: DashboardSectionProps) {
  return (
    <section className={`min-w-0 ${className ?? ""}`}>
      {(title || description) && (
        <header className="mb-4 flex flex-col gap-1.5 sm:mb-5">
          {title && (
            <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white sm:text-xl">
              {title}
            </h2>
          )}

          {description && (
            <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
        </header>
      )}

      {children}
    </section>
  );
}