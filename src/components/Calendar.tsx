import React, { useState, useMemo, useEffect } from 'react';
import logger from '../utils/logger';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon,
  Clock,
  User,
  AlertTriangle,
  FileText,
  Hash,
  ExternalLink,
  Search,
  X
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { JobEntry } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { ConfirmationModal } from './ConfirmationModal';
import { PageHeader } from './PageHeader';
import { calculateTotalHours } from '../utils/jobUtils';

interface CalendarProps {
  onNavigate?: (page: string) => void;
}

export function Calendar({ onNavigate }: CalendarProps = {}) {
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { jobEntries, addJobEntry, updateJobEntry, refreshJobEntries } = useJobs();
  const { company } = useCompany();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedJob, setDraggedJob] = useState<JobEntry | null>(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);
  const [selectedDateForNewJob, setSelectedDateForNewJob] = useState<Date | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [jobPositions, setJobPositions] = useState<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null);
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    return monday;
  });

  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
    isGoBDWarning?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Customer creation states
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    email: '',
    address: '',
    postalCode: '',
    city: '',
    country: 'Deutschland',
    taxId: '',
    phone: ''
  });

  // Get locale from company settings
  const locale = company?.locale || 'de-DE';

  // Search functionality
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    const query = searchQuery.toLowerCase();
    return jobEntries.filter((job: JobEntry) => {
      const customer = customers.find(c => c.id === job.customerId);
      const jobTitle = job.title || '';
      const jobDescription = job.description || '';
      const jobCustomerName = job.customerName || '';
      const customerName = customer?.name || '';
      const jobJobNumber = job.jobNumber || '';
      const jobExternalJobNumber = job.externalJobNumber || '';
      
      return (
        jobTitle.toLowerCase().includes(query) ||
        jobDescription.toLowerCase().includes(query) ||
        jobCustomerName.toLowerCase().includes(query) ||
        customerName.toLowerCase().includes(query) ||
        jobJobNumber.toLowerCase().includes(query) ||
        jobExternalJobNumber.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, jobEntries, customers]);

  // Effect to clear highlight after 2 seconds
  useEffect(() => {
    if (highlightedJobId) {
      const timer = setTimeout(() => {
        setHighlightedJobId(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightedJobId]);

  // Effect to close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target && !target.closest('.search-container')) {
        setShowSearchResults(false);
      }
    };

    if (showSearchResults) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSearchResults]);

  // Function to jump to job date and highlight it
  const jumpToJob = (job: JobEntry) => {
    const jobDate = new Date(job.date);
    
    // Update current date for month view
    setCurrentDate(new Date(jobDate.getFullYear(), jobDate.getMonth(), 1));
    
    // Update week start for mobile view
    const dayOfWeek = jobDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(jobDate);
    monday.setDate(jobDate.getDate() - mondayOffset);
    setCurrentWeekStart(monday);
    
    // Expand the date if it has many jobs
    const dateKey = jobDate.toDateString();
    const jobsOnDate = getJobsForDate(jobDate);
    if (jobsOnDate.length > 3) {
      setExpandedDates(prev => new Set([...prev, dateKey]));
    }
    
    // Highlight the job
    setHighlightedJobId(job.id);
    
    // Close search results
    setShowSearchResults(false);
    setSearchQuery('');
  };

  // Calendar navigation
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    setExpandedDates(new Set()); // Reset expanded dates when changing month
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    setExpandedDates(new Set()); // Reset expanded dates when changing month
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    setCurrentWeekStart(monday);
  };

  // Week navigation for mobile
  const goToPreviousWeek = () => {
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    setCurrentWeekStart(prevWeek);
  };

  const goToNextWeek = () => {
    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    setCurrentWeekStart(nextWeek);
  };

  // Get calendar data
  const { calendarDays, monthYear } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    const endDate = new Date(lastDay);
    
    // Start from Monday (1 = Monday, 0 = Sunday)
    const startDayOfWeek = firstDay.getDay();
    const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
    startDate.setDate(firstDay.getDate() - mondayOffset);
    
    // End on Sunday to complete the week
    const endDayOfWeek = lastDay.getDay();
    const sundayOffset = endDayOfWeek === 0 ? 0 : 7 - endDayOfWeek;
    endDate.setDate(lastDay.getDate() + sundayOffset);
    
    const days = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    const monthYear = firstDay.toLocaleDateString(locale, { 
      month: 'long', 
      year: 'numeric' 
    });
    
    return { calendarDays: days, monthYear };
  }, [currentDate, locale]);

  // Get week data for mobile view
  const { weekDays: currentWeekDays, weekRange } = useMemo(() => {
    const weekDays = [];
    const current = new Date(currentWeekStart);
    
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    const startDate = weekDays[0];
    const endDate = weekDays[6];
    
    const weekRange = `${startDate.getDate()}.${String(startDate.getMonth() + 1).padStart(2, '0')}.${startDate.getFullYear()} - ${endDate.getDate()}.${String(endDate.getMonth() + 1).padStart(2, '0')}.${endDate.getFullYear()}`;
    
    return { weekDays, weekRange };
  }, [currentWeekStart]);

  // Get jobs for a specific date
  const getJobsForDate = (date: Date) => {
    const jobs = jobEntries.filter((job: JobEntry) => {
      const jobDate = new Date(job.date);
      return jobDate.toDateString() === date.toDateString();
    });
    
    // Sort jobs by position for the day, then by creation time as fallback
    return jobs.sort((a, b) => {
      const positionA = jobPositions.get(`${date.toDateString()}-${a.id}`) ?? 999;
      const positionB = jobPositions.get(`${date.toDateString()}-${b.id}`) ?? 999;
      
      if (positionA !== positionB) {
        return positionA - positionB;
      }
      
      // Fallback to creation time if positions are equal
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  };

  // Check if date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // Check if date is in current month
  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === currentDate.getMonth();
  };

  // Toggle expanded state for a specific date
  const toggleExpandedDate = (date: Date) => {
    const dateKey = date.toDateString();
    const newExpandedDates = new Set(expandedDates);
    
    if (newExpandedDates.has(dateKey)) {
      newExpandedDates.delete(dateKey);
    } else {
      newExpandedDates.add(dateKey);
    }
    
    setExpandedDates(newExpandedDates);
  };

  // Check if a date is expanded
  const isDateExpanded = (date: Date) => {
    return expandedDates.has(date.toDateString());
  };

  // Get status color for job
  const getStatusColor = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'in-progress': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'invoiced': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // Get priority color
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, job: JobEntry) => {
    setDraggedJob(job);
    e.dataTransfer.effectAllowed = 'move';
    // Add visual feedback
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Reset visual feedback
    (e.currentTarget as HTMLElement).style.opacity = '1';
    setDraggedJob(null);
    setDragOverDate(null);
  };

  const handleDragOver = (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(targetDate);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Check if we're really leaving this specific cell
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverDate(null);
    }
  };

  // Handle dropping within the same day to reorder jobs
  const handleJobDrop = (e: React.DragEvent, targetDate: Date, targetJobId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedJob) return;

    const jobDate = new Date(draggedJob.date);
    const isSameDate = jobDate.toDateString() === targetDate.toDateString();
    
    if (isSameDate && targetJobId) {
      // Reordering within the same day
      const dayJobs = getJobsForDate(targetDate);
      const draggedIndex = dayJobs.findIndex(job => job.id === draggedJob.id);
      const targetIndex = dayJobs.findIndex(job => job.id === targetJobId);
      
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        // Update positions
        const newPositions = new Map(jobPositions);
        const dateKey = targetDate.toDateString();
        
        // Reorder the jobs array
        const reorderedJobs = [...dayJobs];
        const [movedJob] = reorderedJobs.splice(draggedIndex, 1);
        reorderedJobs.splice(targetIndex, 0, movedJob);
        
        // Update positions in the map
        reorderedJobs.forEach((job, index) => {
          newPositions.set(`${dateKey}-${job.id}`, index);
        });
        
        setJobPositions(newPositions);
      }
    }
    
    setDraggedJob(null);
    setDragOverDate(null);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragOverDate(null);
    
    if (!draggedJob) return;

    // Don't allow dropping on the same date
    const jobDate = new Date(draggedJob.date);
    if (jobDate.toDateString() === targetDate.toDateString()) {
      setDraggedJob(null);
      return;
    }

    try {
      // Create date string in YYYY-MM-DD format (ISO date without time)
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;
      
      // Update job date using the ISO date string
      await updateJobEntry(draggedJob.id, {
        ...draggedJob,
        date: dateString
      });

      // Clear position for the moved job from old date and assign new position
      const newPositions = new Map(jobPositions);
      const oldDateKey = jobDate.toDateString();
      const newDateKey = targetDate.toDateString();
      
      // Remove from old date
      newPositions.delete(`${oldDateKey}-${draggedJob.id}`);
      
      // Add to new date at the end
      const targetDayJobs = getJobsForDate(targetDate);
      newPositions.set(`${newDateKey}-${draggedJob.id}`, targetDayJobs.length);
      
      setJobPositions(newPositions);
      
      logger.info('Job moved via drag and drop', { 
        jobTitle: draggedJob.title, 
        targetDate: targetDate.toLocaleDateString(locale),
        jobId: draggedJob.id 
      });
    } catch (error) {
      logger.error('Error updating job date:', error);
    } finally {
      setDraggedJob(null);
    }
  };

  // Double click handler for job editing
  const handleJobDoubleClick = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: 'Auftrag bearbeiten',
        message: 'Dieser Auftrag wurde bereits abgerechnet. Änderungen an abgerechneten Aufträgen sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?',
        onConfirm: () => {
          setEditingJob(job);
          setShowJobForm(true);
        },
        isGoBDWarning: true
      });
    } else {
      setEditingJob(job);
      setShowJobForm(true);
    }
  };

  // Double click handler for creating new job on a specific date
  const handleDateDoubleClick = (date: Date) => {
    setEditingJob(null); // Clear any existing job
    
    // Create date string in YYYY-MM-DD format to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    // Create a new Date object from the ISO string to ensure consistency
    const correctedDate = new Date(dateString + 'T12:00:00.000Z');
    
    setSelectedDateForNewJob(correctedDate);
    setShowJobForm(true);
  };

  // Form submit handler
  const handleFormSubmit = async (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingJob) {
        await updateJobEntry(editingJob.id, jobData);
      } else {
        await addJobEntry(jobData);
        // Refresh job entries in other components  
        await refreshJobEntries();
      }
      setShowJobForm(false);
      setEditingJob(null);
    } catch (error) {
      logger.error('Error saving job:', error);
    }
  };

  const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader icon={CalendarIcon} title="Kalender">
        
        {/* Search Bar */}
        <div className="relative w-full sm:w-auto search-container">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Aufträge suchen..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.trim().length > 0);
              }}
              onFocus={() => setShowSearchResults(searchQuery.trim().length > 0)}
              className="pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent w-full sm:w-64"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchResults(false);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          
          {/* Search Results Dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
              {searchResults.map((job) => {
                const customer = customers.find(c => c.id === job.customerId);
                const jobDate = new Date(job.date);
                const totalHours = calculateTotalHours(job);
                
                return (
                  <div
                    key={job.id}
                    onClick={() => jumpToJob(job)}
                    className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center">
                          {job.priority && (
                            <AlertTriangle className={`h-4 w-4 mr-2 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                          )}
                          <span className="font-medium text-gray-900 truncate">
                            {job.title}
                          </span>
                          {job.attachments && job.attachments.length > 0 && (
                            <FileText className="h-4 w-4 ml-2 flex-shrink-0 text-gray-400" />
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          <div className="flex items-center">
                            <User className="h-3 w-3 mr-1" />
                            <span className="truncate">{customer?.name || job.customerName}</span>
                          </div>
                          <div className="flex items-center mt-1">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            <span>{jobDate.toLocaleDateString(locale)}</span>
                            <Clock className="h-3 w-3 ml-3 mr-1" />
                            <span>{totalHours.toFixed(1)}h</span>
                          </div>
                          {job.jobNumber && (
                            <div className="flex items-center mt-1">
                              <Hash className="h-3 w-3 mr-1" />
                              <span className="truncate">{job.jobNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={`ml-3 px-2 py-1 rounded text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status === 'draft' ? 'Entwurf' :
                         job.status === 'in-progress' ? 'In Bearbeitung' :
                         job.status === 'completed' ? 'Abgeschlossen' :
                         job.status === 'invoiced' ? 'Abgerechnet' : job.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* No Results Message */}
          {showSearchResults && searchQuery.trim() && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4 text-center text-gray-500">
              Keine Aufträge gefunden
            </div>
          )}
        </div>
        </PageHeader>
      </div>

      {/* Calendar Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 lg:p-4">
        {/* Desktop Controls - Month view */}
        <div className="hidden md:flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={goToPreviousMonth}
              className="min-h-0 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Vorheriger Monat"
            >
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>
            
            <h2 className="text-base lg:text-lg font-semibold text-gray-900 capitalize">
              {monthYear}
            </h2>
            
            <button
              onClick={goToNextMonth}
              className="min-h-0 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Nächster Monat"
            >
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          
          <button
            onClick={goToToday}
            className="min-h-0 bg-primary-custom text-white px-3 py-1.5 rounded-lg hover:bg-primary-custom/90 transition-colors text-sm"
          >
            Heute
          </button>
        </div>

        {/* Mobile Controls - Week view */}
        <div className="md:hidden flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={goToPreviousWeek}
              className="min-h-0 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Vorherige Woche"
            >
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>
            
            <h2 className="text-sm font-semibold text-gray-900">
              {weekRange}
            </h2>
            
            <button
              onClick={goToNextWeek}
              className="min-h-0 p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Nächste Woche"
            >
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          
          <button
            onClick={goToToday}
            className="min-h-0 bg-primary-custom text-white px-2.5 py-1 rounded-lg hover:bg-primary-custom/90 transition-colors text-xs"
          >
            Heute
          </button>
        </div>

        {/* Desktop Calendar Grid */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 gap-1 lg:gap-2">
            {/* Week day headers */}
            {weekDays.map((day) => (
              <div
                key={day}
                className="p-2 text-center text-xs lg:text-sm font-medium text-gray-500 uppercase"
              >
                {day}
              </div>
            ))}
            
            {/* Calendar days */}
            {calendarDays.map((date, index) => {
              const dayJobs = getJobsForDate(date);
              const isDayToday = isToday(date);
              const isInCurrentMonth = isCurrentMonth(date);
              const isDragOver = dragOverDate && date.toDateString() === dragOverDate.toDateString();
              
              return (
                <div
                  key={index}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, date)}
                  className={`
                    min-h-[80px] lg:min-h-[120px] border border-gray-200 
                    ${isDayToday ? 'bg-primary-custom/10 border-primary-custom' : 'bg-white hover:bg-gray-50'}
                    ${!isInCurrentMonth ? 'bg-gray-50 text-gray-400' : ''}
                    ${isDragOver ? 'bg-blue-100 border-blue-400 border-2 shadow-md' : ''}
                    transition-all duration-200 relative flex flex-col
                  `}
                >
                  {/* Date header - clickable area for creating new jobs */}
                  <div 
                    className={`
                      p-1 lg:p-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50
                      ${isDayToday ? 'bg-primary-custom/5' : ''}
                      transition-colors duration-200
                    `}
                    onDoubleClick={() => handleDateDoubleClick(date)}
                    title="Doppelklick zum Erstellen eines neuen Auftrags"
                  >
                    <div className={`
                      text-sm lg:text-base font-medium
                      ${isDayToday ? 'text-primary-custom font-bold' : ''}
                      ${!isInCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                    `}>
                      {date.getDate()}
                    </div>
                  </div>
                  
                  {/* Jobs area */}
                  <div className="flex-1 p-1 lg:p-2 space-y-1">
                    {(() => {
                      const isExpanded = isDateExpanded(date);
                      const jobsToShow = isExpanded ? dayJobs : dayJobs.slice(0, 3);
                      
                      return (
                        <>
                          {jobsToShow.map((job, jobIndex) => {
                            const customer = customers.find(c => c.id === job.customerId);
                            const totalHours = calculateTotalHours(job);
                            
                            return (
                              <React.Fragment key={job.id}>
                                {/* Drop zone before the job */}
                                {jobIndex === 0 && draggedJob && 
                                 new Date(draggedJob.date).toDateString() === date.toDateString() && 
                                 draggedJob.id !== job.id && (
                                  <div
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleJobDrop(e, date, job.id);
                                    }}
                                    className="h-2 border-2 border-dashed border-blue-300 rounded bg-blue-50 opacity-50"
                                    title="Hier ablegen"
                                  />
                                )}
                                
                                <div
                                  draggable={job.status !== 'invoiced'}
                                  onDragStart={(e) => handleDragStart(e, job)}
                                  onDragEnd={handleDragEnd}
                                  onDoubleClick={() => handleJobDoubleClick(job)}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onDrop={(e) => handleJobDrop(e, date, job.id)}
                                  className={`
                                    text-xs p-1 lg:p-2 rounded border cursor-move
                                    ${getStatusColor(job.status)}
                                    ${job.status === 'invoiced' ? 'cursor-not-allowed opacity-75' : 'hover:shadow-sm'}
                                    ${draggedJob && draggedJob.id !== job.id && 
                                      new Date(draggedJob.date).toDateString() === date.toDateString() ? 
                                      'border-blue-300 border-dashed' : ''}
                                    ${highlightedJobId === job.id ? 'ring-2 ring-red-500 bg-red-100 border-red-500' : ''}
                                    transition-all duration-150
                                  `}
                                  title={`${job.title} - ${customer?.name || job.customerName} - ${totalHours.toFixed(1)}h - Doppelklick zum Bearbeiten - Ziehen zum Umordnen`}
                                >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center">
                                      {job.priority && (
                                        <AlertTriangle className={`h-3 w-3 mr-1 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                                      )}
                                      <span className="truncate font-medium">
                                        {job.title}
                                      </span>
                                      {job.attachments && job.attachments.length > 0 && (
                                        <FileText className="h-3 w-3 ml-1 flex-shrink-0 text-gray-400" title="Anhänge vorhanden" />
                                      )}
                                    </div>
                                    <div className="flex items-center mt-1 text-xs opacity-75">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0" />
                                      <span className="truncate">{customer?.name || job.customerName}</span>
                                    </div>
                                    {job.jobNumber && (
                                      <div className="flex items-center mt-1 text-xs opacity-75">
                                        <Hash className="h-3 w-3 mr-1 flex-shrink-0" />
                                        <span className="truncate">{job.jobNumber}</span>
                                      </div>
                                    )}
                                    {job.externalJobNumber && (
                                      <div className="flex items-center mt-1 text-xs opacity-75">
                                        <ExternalLink className="h-3 w-3 mr-1 flex-shrink-0" />
                                        <span className="truncate">{job.externalJobNumber}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center mt-1 text-xs opacity-75">
                                      <Clock className="h-3 w-3 mr-1 flex-shrink-0" />
                                      <span>{totalHours.toFixed(1)}h</span>
                                    </div>
                                  </div>
                                </div>
                                </div>
                              </React.Fragment>
                            );
                          })}
                          
                          {/* Show toggle button if more jobs exist */}
                          {dayJobs.length > 3 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandedDate(date);
                              }}
                              className="w-full text-xs text-gray-500 hover:text-gray-700 text-center py-1 hover:bg-gray-50 rounded transition-colors"
                              title={isExpanded ? "Weniger anzeigen" : "Alle anzeigen"}
                            >
                              {isExpanded ? 
                                `Weniger anzeigen` : 
                                `+${dayJobs.length - 3} weitere`
                              }
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile Week View */}
        <div className="md:hidden space-y-3">
          {currentWeekDays.map((date, index) => {
            const dayJobs = getJobsForDate(date);
            const isDayToday = isToday(date);
            const isDragOver = dragOverDate && date.toDateString() === dragOverDate.toDateString();
            const dayName = date.toLocaleDateString(locale, { weekday: 'short' });
            
            return (
              <div
                key={index}
                onDragOver={(e) => handleDragOver(e, date)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, date)}
                className={`
                  border border-gray-200 rounded-lg overflow-hidden
                  ${isDayToday ? 'border-primary-custom bg-primary-custom/5' : 'bg-white'}
                  ${isDragOver ? 'bg-blue-100 border-blue-400 border-2 shadow-md' : ''}
                  transition-all duration-200
                `}
              >
                {/* Date header */}
                <div 
                  className={`
                    p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50
                    ${isDayToday ? 'bg-primary-custom/10' : 'bg-gray-50'}
                    transition-colors duration-200
                  `}
                  onDoubleClick={() => handleDateDoubleClick(date)}
                  title="Doppelklick zum Erstellen eines neuen Auftrags"
                >
                  <div className="flex items-center justify-between">
                    <div className={`
                      font-medium
                      ${isDayToday ? 'text-primary-custom' : 'text-gray-900'}
                    `}>
                      {dayName}, {date.getDate()}.{String(date.getMonth() + 1).padStart(2, '0')}.
                    </div>
                    {dayJobs.length > 0 && (
                      <div className="text-xs text-gray-500">
                        {dayJobs.length} Auftrag{dayJobs.length > 1 ? 'e' : ''}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Jobs list */}
                <div className="p-3 space-y-2">
                  {dayJobs.length === 0 ? (
                    <div className="text-center py-4 text-gray-400 text-sm">
                      Keine Aufträge
                    </div>
                  ) : (
                    dayJobs.map((job, jobIndex) => {
                      const customer = customers.find(c => c.id === job.customerId);
                      const totalHours = calculateTotalHours(job);
                      
                      return (
                        <React.Fragment key={job.id}>
                          {/* Drop zone before the job */}
                          {jobIndex === 0 && draggedJob && 
                           new Date(draggedJob.date).toDateString() === date.toDateString() && 
                           draggedJob.id !== job.id && (
                            <div
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleJobDrop(e, date, job.id);
                              }}
                              className="h-3 border-2 border-dashed border-blue-300 rounded bg-blue-50 opacity-50 mx-3"
                              title="Hier ablegen"
                            />
                          )}
                          
                          <div
                            draggable={job.status !== 'invoiced'}
                            onDragStart={(e) => handleDragStart(e, job)}
                            onDragEnd={handleDragEnd}
                            onDoubleClick={() => handleJobDoubleClick(job)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onDrop={(e) => handleJobDrop(e, date, job.id)}
                            className={`
                              p-3 rounded border cursor-move
                              ${getStatusColor(job.status)}
                              ${job.status === 'invoiced' ? 'cursor-not-allowed opacity-75' : 'hover:shadow-sm'}
                              ${draggedJob && draggedJob.id !== job.id && 
                                new Date(draggedJob.date).toDateString() === date.toDateString() ? 
                                'border-blue-300 border-dashed' : ''}
                              ${highlightedJobId === job.id ? 'ring-2 ring-red-500 bg-red-100 border-red-500' : ''}
                              transition-all duration-150
                            `}
                            title={`${job.title} - ${customer?.name || job.customerName} - ${totalHours.toFixed(1)}h - Doppelklick zum Bearbeiten - Ziehen zum Umordnen`}
                          >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center mb-1">
                                {job.priority && (
                                  <AlertTriangle className={`h-4 w-4 mr-2 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                                )}
                                <span className="font-medium truncate">
                                  {job.title}
                                </span>
                                {job.attachments && job.attachments.length > 0 && (
                                  <FileText className="h-4 w-4 ml-2 flex-shrink-0 text-gray-400" title="Anhänge vorhanden" />
                                )}
                              </div>
                              <div className="flex items-center text-sm text-gray-600 mb-1">
                                <User className="h-4 w-4 mr-2 flex-shrink-0" />
                                <span className="truncate">{customer?.name || job.customerName}</span>
                              </div>
                              {job.jobNumber && (
                                <div className="flex items-center text-sm text-gray-600 mb-1">
                                  <Hash className="h-4 w-4 mr-2 flex-shrink-0" />
                                  <span className="truncate">{job.jobNumber}</span>
                                </div>
                              )}
                              {job.externalJobNumber && (
                                <div className="flex items-center text-sm text-gray-600 mb-1">
                                  <ExternalLink className="h-4 w-4 mr-2 flex-shrink-0" />
                                  <span className="truncate">{job.externalJobNumber}</span>
                                </div>
                              )}
                              <div className="flex items-center text-sm text-gray-600">
                                <Clock className="h-4 w-4 mr-2 flex-shrink-0" />
                                <span>{totalHours.toFixed(1)}h</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        </React.Fragment>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Legende</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="flex items-center">
              <div className="w-3 h-3 rounded bg-gray-100 border border-gray-200 mr-2"></div>
              <span className="text-gray-600">Entwurf</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 mr-2"></div>
              <span className="text-gray-600">In Bearbeitung</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded bg-green-100 border border-green-200 mr-2"></div>
              <span className="text-gray-600">Abgeschlossen</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 rounded bg-blue-100 border border-blue-200 mr-2"></div>
              <span className="text-gray-600">Abgerechnet</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            <p>• Ziehen Sie Aufträge per Drag & Drop, um das Datum zu ändern</p>
            <p>• Ziehen Sie Aufträge innerhalb eines Tages, um die Reihenfolge zu ändern</p>
            <p>• Doppelklicken Sie auf einen Auftrag, um ihn zu bearbeiten</p>
            <p>• Doppelklicken Sie auf das Datum, um einen neuen Auftrag zu erstellen</p>
            <p>• Abgerechnete Aufträge können nicht verschoben werden</p>
          </div>
        </div>
      </div>

      {/* Job Form Modal */}
      {showJobForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden">
            <JobEntryForm
              job={editingJob}
              customers={customers}
              defaultDate={selectedDateForNewJob}
              onSubmit={handleFormSubmit}
              onCancel={() => {
                setShowJobForm(false);
                setEditingJob(null);
                setSelectedDateForNewJob(null);
              }}
              onCreateCustomer={() => {
                setShowCustomerForm(true);
              }}
              onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
              onNavigateToSettings={() => onNavigate && onNavigate('settings')}
            />
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isDestructive={confirmModal.isDestructive}
        isGoBDWarning={confirmModal.isGoBDWarning}
      />

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Neuer Kunde
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await addCustomer(newCustomerData);
                setNewCustomerData({
                  name: '',
                  email: '',
                  address: '',
                  postalCode: '',
                  city: '',
                  country: 'Deutschland',
                  taxId: '',
                  phone: ''
                });
                setShowCustomerForm(false);
                
                // Refresh customers in other components
                await refreshCustomers();
              } catch (error) {
                logger.error('Error creating customer:', error);
              }
            }} className="space-y-4">
              <div>
                <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="customerName"
                  required
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="customerEmail" className="block text-sm font-medium text-gray-700 mb-2">
                  E-Mail
                </label>
                <input
                  type="email"
                  id="customerEmail"
                  value={newCustomerData.email}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="customerAddress" className="block text-sm font-medium text-gray-700 mb-2">
                  Adresse
                </label>
                <input
                  type="text"
                  id="customerAddress"
                  value={newCustomerData.address}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="customerPostalCode" className="block text-sm font-medium text-gray-700 mb-2">
                    PLZ
                  </label>
                  <input
                    type="text"
                    id="customerPostalCode"
                    value={newCustomerData.postalCode}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, postalCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="customerCity" className="block text-sm font-medium text-gray-700 mb-2">
                    Stadt
                  </label>
                  <input
                    type="text"
                    id="customerCity"
                    value={newCustomerData.city}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="customerCountry" className="block text-sm font-medium text-gray-700 mb-2">
                  Land
                </label>
                <input
                  type="text"
                  id="customerCountry"
                  value={newCustomerData.country}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="customerTaxId" className="block text-sm font-medium text-gray-700 mb-2">
                  Steuernummer
                </label>
                <input
                  type="text"
                  id="customerTaxId"
                  value={newCustomerData.taxId}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, taxId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="customerPhone" className="block text-sm font-medium text-gray-700 mb-2">
                  Telefon
                </label>
                <input
                  type="tel"
                  id="customerPhone"
                  value={newCustomerData.phone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCustomerForm(false)}
                  className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Kunde erstellen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
