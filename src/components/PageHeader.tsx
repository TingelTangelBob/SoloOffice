import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function PageHeader({ icon: Icon, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="w-full flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
      <div className="flex items-center min-w-0">
        <Icon className="h-6 w-6 lg:h-8 lg:w-8 text-primary-custom mr-2 lg:mr-3 flex-shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl lg:text-3xl font-bold text-gray-900 break-words">{title}</h1>
          {subtitle && <p className="text-gray-600 mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
