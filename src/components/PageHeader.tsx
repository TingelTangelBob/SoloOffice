import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  singleRow?: boolean;
}

export function PageHeader({ icon: Icon, title, subtitle, children, singleRow = false }: PageHeaderProps) {
  return (
    <div className={`fixed inset-x-0 top-0 z-10 flex min-h-16 w-full items-center gap-2 overflow-hidden border-b border-gray-200 bg-white px-3 pl-16 shadow-sm lg:static lg:min-h-0 lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ${singleRow ? 'lg:flex-row lg:justify-between' : 'lg:flex-row lg:justify-between'} lg:gap-4`}>
      <div className="flex min-w-0 flex-1 items-center overflow-visible">
        {Icon && <Icon className="h-5 w-5 flex-shrink-0 text-primary-custom sm:mr-2 sm:h-6 sm:w-6 lg:mr-3 lg:h-8 lg:w-8" />}
        <div className="min-w-0">
          <h1 className="min-w-0 break-words text-lg font-bold leading-normal text-gray-900 sm:text-xl lg:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 hidden text-gray-600 lg:block">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex min-w-0 max-w-[58%] shrink items-center justify-end gap-1 overflow-x-auto sm:gap-2 lg:max-w-none lg:overflow-visible">{children}</div>}
    </div>
  );
}
