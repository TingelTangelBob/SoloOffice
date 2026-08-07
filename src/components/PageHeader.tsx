import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function PageHeader({ icon: Icon, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="page-header fixed inset-x-0 top-0 z-10 flex h-16 min-h-16 w-full flex-nowrap items-center gap-2 overflow-hidden border-b border-gray-100 bg-white px-3 pl-16 tablet:gap-3 lg:static lg:h-auto lg:min-h-0 lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:flex-row lg:justify-between lg:gap-4">
      <div className="flex min-w-0 basis-0 flex-1 items-center overflow-visible">
        {Icon && <Icon className="mr-2 h-5 w-5 flex-shrink-0 text-primary-custom sm:h-6 sm:w-6 lg:mr-3 lg:h-8 lg:w-8" />}
        <div className="min-w-0 flex-1">
          <h1 className="min-w-0 break-words text-xl font-bold leading-tight text-gray-900 sm:text-2xl lg:text-3xl" title={title}>{title}</h1>
          {subtitle && <p className="mt-1 hidden text-gray-600 lg:block">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex min-w-0 max-w-[58%] shrink-0 items-center justify-end gap-1 overflow-x-auto whitespace-nowrap sm:gap-2 lg:max-w-none lg:overflow-visible">{children}</div>}
    </div>
  );
}
