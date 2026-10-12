import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

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
  className 
}: DashboardLayoutProps) {
  return (
    <div className={className}>
      {/* Page Header */}
      {(title || description || actions) && (
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              {title && (
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {title}
                </h1>
              )}
              {description && (
                <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
                  {description}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-3">
                {actions}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Page Content */}
      {children}
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
  className 
}: DashboardCardProps) {
  return (
    <Card className={className}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
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
  className 
}: DashboardSectionProps) {
  return (
    <section className={className}>
      {(title || description) && (
        <div className="mb-6">
          {title && (
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {title}
            </h2>
          )}
          {description && (
            <p className="text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  );
} 