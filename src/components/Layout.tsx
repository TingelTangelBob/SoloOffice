import { ReactNode, useState } from 'react';
import { FileText, Users, Settings, BarChart3, Building2, Menu, X, Briefcase, Calendar, Home, FileCheck, Bell } from 'lucide-react';
import { DynamicColors } from './DynamicColors';
import { useCompany } from '../context/CompanyContext';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

export function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { company } = useCompany();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const baseNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'invoices', label: 'Rechnungen', icon: FileText },
    { id: 'customers', label: 'Kunden', icon: Users },
  ];

  const quotesNavItem = { id: 'quotes', label: 'Angebote', icon: FileCheck };
  const jobNavItem = { id: 'jobs', label: 'Aufträge', icon: Briefcase };
  const calendarNavItem = { id: 'calendar', label: 'Kalender', icon: Calendar };
  const reportingNavItem = { id: 'reporting', label: 'Reporting', icon: BarChart3 };
  const remindersNavItem = { id: 'reminders', label: 'Mahnungen', icon: Bell };
  const settingsNavItem = { id: 'settings', label: 'Einstellungen', icon: Settings };

  // Only include quotes if enabled, jobs/calendar if job tracking is enabled, reporting if reporting is enabled, reminders if reminders enabled
  const navItems = [
    ...baseNavItems,
    ...(company.quotesEnabled ? [quotesNavItem] : []),
    ...(company.jobTrackingEnabled ? [jobNavItem, calendarNavItem] : []),
    ...(company.reportingEnabled ? [reportingNavItem] : []),
    ...(company.remindersEnabled ? [remindersNavItem] : []),
    settingsNavItem,
  ];

  const handlePageChange = (page: string) => {
    onPageChange(page);
    setIsMobileMenuOpen(false); // Close mobile menu when navigating
  };

  return (
    <>
      <DynamicColors />
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 relative z-30">
          <div className="px-4 lg:px-6 py-2 lg:py-2.5">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => handlePageChange('dashboard')}
                className="flex items-center hover:opacity-80 transition-opacity"
              >
                {company.icon ? (
                  <img 
                    src={company.icon} 
                    alt="Company Icon" 
                    className="h-6 w-6 lg:h-8 lg:w-8 mr-2 lg:mr-3 rounded"
                  />
                ) : (
                  <Building2 className="h-6 w-6 lg:h-8 lg:w-8 text-primary-custom mr-2 lg:mr-3" />
                )}
                <h1 className="text-lg lg:text-2xl font-bold text-gray-900">SoloOffice</h1>
              </button>
              
              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors touch-target"
                aria-label={isMobileMenuOpen ? 'Menü schließen' : 'Menü öffnen'}
              >
                {isMobileMenuOpen ? (
                  <X className="h-6 w-6" />
                ) : (
                  <Menu className="h-6 w-6" />
                )}
              </button>
            </div>
          </div>
        </header>

        <div className="flex relative">
          {/* Mobile backdrop */}
          {isMobileMenuOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Sidebar */}
          <nav className={`
            fixed lg:sticky lg:top-0 lg:bottom-auto inset-y-0 left-0 z-20
            w-64 flex-shrink-0 bg-white shadow-sm transform transition-transform duration-300 ease-in-out
            lg:transform-none lg:shadow-none lg:h-screen lg:self-start
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}>
            <div className="p-4 pt-20 lg:pt-4">
              <ul className="space-y-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => handlePageChange(item.id)}
                        className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                          currentPage === item.id
                            ? 'nav-active'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-5 w-5 mr-3 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1 min-w-0 p-3 sm:p-4 lg:p-6 lg:ml-0 min-h-screen safe-area-bottom">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
