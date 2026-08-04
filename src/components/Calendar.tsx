import React, { useState, useMemo, useEffect, useRef } from 'react';
import logger from '../utils/logger';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Calendar as CalendarIcon,
  Clock,
  User,
  AlertTriangle,
  FileText,
  Hash,
  ExternalLink,
  Search,
  Share2,
  X,
  Plus,
  Trash2,
  Edit,
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { CalendarEvent, JobEntry } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { ConfirmationModal } from './ConfirmationModal';
import { PageHeader } from './PageHeader';
import { getTerminology } from '../utils/terminology';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatDate, formatNumber, formatTime } from '../utils/formatters';
import { apiService } from '../services/api';

interface CalendarProps {
  onNavigate?: (page: string) => void;
}

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDateKey = (date: Date) => toDateInputValue(date);

const CALENDAR_START_HOUR = 0;
const CALENDAR_END_HOUR = 24;
const CALENDAR_HOUR_HEIGHT = 56;

type CalendarDensity = 'spacious' | 'compact' | 'minimal' | 'indicator';

interface CalendarCellSize {
  width: number;
  height: number;
}

interface TimeGridDragPreview {
  dateKey: string;
  startMinutes: number;
}

const getCalendarDensity = (width: number, height: number, entryCount: number): CalendarDensity => {
  let density: CalendarDensity = 'indicator';

  if (width >= 170 && height >= 120) {
    density = 'spacious';
  } else if (width >= 110 && height >= 85) {
    density = 'compact';
  } else if (width >= 70 && height >= 58) {
    density = 'minimal';
  }

  if (entryCount >= 8) return 'indicator';
  if (entryCount >= 5 && density === 'spacious') return 'compact';
  if (entryCount >= 6 && density === 'compact') return 'minimal';

  return density;
};

const getMaxVisibleEntries = (density: CalendarDensity, cellHeight: number) => {
  const contentHeight = Math.max(0, cellHeight - 38);

  switch (density) {
    case 'spacious':
      return Math.max(1, Math.floor(contentHeight / 66));
    case 'compact':
      return Math.max(1, Math.floor(contentHeight / 44));
    case 'minimal':
      return Math.max(1, Math.floor(contentHeight / 25));
    case 'indicator':
      return 1;
  }
};

const parseTimeToMinutes = (time?: string, fallback = 8 * 60) => {
  if (!time) return fallback;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return Math.max(0, Math.min(24 * 60, hours * 60 + minutes));
};

const formatMinutesToTime = (minutes: number, locale = 'de-DE', timeFormat?: '24h' | '12h') => {
  const normalizedMinutes = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const value = `${String(Math.floor(normalizedMinutes / 60)).padStart(2, '0')}:${String(normalizedMinutes % 60).padStart(2, '0')}`;
  return formatTime(value, locale, timeFormat);
};

export function Calendar({ onNavigate }: CalendarProps = {}) {
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { jobEntries, addJobEntry, updateJobEntry, refreshJobEntries } = useJobs();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedJob, setDraggedJob] = useState<JobEntry | null>(null);
  const [timeGridDragPreview, setTimeGridDragPreview] = useState<TimeGridDragPreview | null>(null);
  const [dragPointerOffsetMinutes, setDragPointerOffsetMinutes] = useState(0);
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [previewingJob, setPreviewingJob] = useState<JobEntry | null>(null);
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);
  const [selectedDateForNewJob, setSelectedDateForNewJob] = useState<Date | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [jobPositions, setJobPositions] = useState<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'workweek' | 'month'>('month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerView, setDatePickerView] = useState<'months' | 'years'>('months');
  const [datePickerYear, setDatePickerYear] = useState(new Date().getFullYear());
  const [showShareDialog, setShowShareDialog] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
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

  useEffect(() => {
    const loadCalendarEvents = async () => {
      try {
        setCalendarEvents(await apiService.getCalendarEvents());
      } catch (error) {
        logger.error('Error loading calendar events:', error);
      }
    };

    loadCalendarEvents();
  }, []);

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

  useEffect(() => {
    if (!showDatePicker) return;

    const handleDatePickerClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (datePickerRef.current && target instanceof Node && !datePickerRef.current.contains(target)) {
        setShowDatePicker(false);
      }
    };

    document.addEventListener('mousedown', handleDatePickerClickOutside);
    return () => document.removeEventListener('mousedown', handleDatePickerClickOutside);
  }, [showDatePicker]);

  // Function to jump to job date and highlight it
  const jumpToJob = (job: JobEntry) => {
    const jobDate = new Date(job.date);
    setSelectedDate(jobDate);
    
    // Update current date for month view
    setCurrentDate(new Date(jobDate.getFullYear(), jobDate.getMonth(), 1));
    
    // Update week start for mobile view
    setCurrentWeekStart(getWeekStart(jobDate));
    
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
    setIsSearchOpen(false);
  };

  // Calendar navigation
  const goToPreviousMonth = () => {
    const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
    setCurrentWeekStart(getWeekStart(nextDate));
    setExpandedDates(new Set()); // Reset expanded dates when changing month
  };

  const goToNextMonth = () => {
    const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
    setCurrentWeekStart(getWeekStart(nextDate));
    setExpandedDates(new Set()); // Reset expanded dates when changing month
  };

  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setCurrentDate(today);
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    setCurrentWeekStart(monday);
  };

  const getWeekStart = (date: Date) => {
    const dayOfWeek = date.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(date);
    monday.setDate(date.getDate() - mondayOffset);
    return monday;
  };

  const selectCalendarDate = (date: Date) => {
    const nextDate = new Date(date);
    setSelectedDate(nextDate);
    setCurrentDate(nextDate);
    setCurrentWeekStart(getWeekStart(nextDate));
  };

  const changeViewMode = (mode: 'day' | 'week' | 'workweek' | 'month') => {
    setViewMode(mode);
    if (mode === 'day') {
      setCurrentDate(new Date(selectedDate));
    } else if (mode === 'week' || mode === 'workweek') {
      setCurrentWeekStart(getWeekStart(selectedDate));
      setCurrentDate(new Date(selectedDate));
    } else {
      setCurrentDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  };

  const navigatePrevious = () => {
    if (viewMode === 'month') {
      goToPreviousMonth();
      return;
    }
    if (viewMode === 'week' || viewMode === 'workweek') {
      goToPreviousWeek();
      return;
    }
    const previousDay = new Date(currentDate);
    previousDay.setDate(previousDay.getDate() - 1);
    selectCalendarDate(previousDay);
  };

  const navigateNext = () => {
    if (viewMode === 'month') {
      goToNextMonth();
      return;
    }
    if (viewMode === 'week' || viewMode === 'workweek') {
      goToNextWeek();
      return;
    }
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    selectCalendarDate(nextDay);
  };

  const selectMonth = (month: number) => {
    const nextDate = new Date(datePickerYear, month, 1);
    setSelectedDate(nextDate);
    setCurrentDate(nextDate);
    setCurrentWeekStart(getWeekStart(nextDate));
    setExpandedDates(new Set());
    setShowDatePicker(false);
  };

  const openDatePicker = () => {
    setDatePickerYear(currentDate.getFullYear());
    setDatePickerView('months');
    setShowDatePicker((previous) => !previous);
  };

  const selectPickerYear = (year: number) => {
    const nextDate = new Date(year, currentDate.getMonth(), 1);
    setSelectedDate(nextDate);
    setCurrentDate(nextDate);
    setCurrentWeekStart(getWeekStart(nextDate));
    setExpandedDates(new Set());
    setDatePickerYear(year);
    setDatePickerView('months');
  };

  const shiftDatePickerPeriod = (direction: number) => {
    setDatePickerYear((previousYear) => previousYear + (datePickerView === 'years' ? direction * 12 : direction));
  };

  const getCalendarWeek = (date: Date) => {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  // Week navigation for mobile
  const goToPreviousWeek = () => {
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    setCurrentWeekStart(prevWeek);
    setSelectedDate(prevWeek);
    setCurrentDate(prevWeek);
  };

  const goToNextWeek = () => {
    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    setCurrentWeekStart(nextWeek);
    setSelectedDate(nextWeek);
    setCurrentDate(nextWeek);
  };

  // Get calendar data
  const { calendarDays } = useMemo(() => {
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
    
    return { calendarDays: days };
  }, [currentDate]);

  const monthGridRef = useRef<HTMLDivElement>(null);
  const timeGridBodyRef = useRef<HTMLDivElement>(null);
  const [monthCellSize, setMonthCellSize] = useState<CalendarCellSize>({ width: 160, height: 140 });

  useEffect(() => {
    if (viewMode !== 'month' || !monthGridRef.current) return;

    const grid = monthGridRef.current;
    const updateCellSize = () => {
      const { width, height } = grid.getBoundingClientRect();
      const weekCount = calendarDays.length / 7;
      setMonthCellSize({
        width: Math.max(0, (width - 40) / 7),
        height: Math.max(0, (height - 56) / weekCount),
      });
    };

    updateCellSize();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateCellSize);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [calendarDays.length, viewMode]);

  // Get week data for mobile view
  const { weekDays: currentWeekDays, weekRange, workWeekRange } = useMemo(() => {
    const weekDays = [];
    const current = new Date(currentWeekStart);
    
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    const startDate = weekDays[0];
    const endDate = weekDays[6];
    const workWeekEndDate = weekDays[4];
    
    const formatPeriodDate = (date: Date) => `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
    const weekRange = `${formatPeriodDate(startDate)} - ${formatPeriodDate(endDate)}`;
    const workWeekRange = `${formatPeriodDate(startDate)} - ${formatPeriodDate(workWeekEndDate)}`;
    
    return { weekDays, weekRange, workWeekRange };
  }, [currentWeekStart]);

  const timeGridDays = viewMode === 'day'
    ? [new Date(selectedDate)]
    : viewMode === 'workweek'
      ? currentWeekDays.slice(0, 5)
      : currentWeekDays;

  const getJobTimeRange = (job: JobEntry) => {
    const timeEntryWithTime = job.timeEntries?.find((entry) => entry.startTime || entry.endTime);
    const startTime = job.startTime || timeEntryWithTime?.startTime;
    const endTime = job.endTime || timeEntryWithTime?.endTime;
    const start = parseTimeToMinutes(startTime);
    const duration = Math.max(60, calculateTotalHours(job) * 60);
    const end = endTime ? parseTimeToMinutes(endTime, start + duration) : start + duration;

    return {
      start,
      end: Math.max(start + 30, end),
    };
  };

  const getJobTimeLabel = (job: JobEntry) => {
    const timeEntryWithTime = job.timeEntries?.find((entry) => entry.startTime || entry.endTime);
    const startTime = job.startTime || timeEntryWithTime?.startTime;
    const endTime = job.endTime || timeEntryWithTime?.endTime;

    if (!startTime && !endTime) return null;

    const { start, end } = getJobTimeRange(job);
    return `${startTime ? formatTime(startTime, locale, company?.timeFormat) : formatMinutesToTime(start, locale, company?.timeFormat)}–${endTime ? formatTime(endTime, locale, company?.timeFormat) : formatMinutesToTime(end, locale, company?.timeFormat)}`;
  };

  const jobsByDate = useMemo(() => {
    const groupedJobs = new Map<string, JobEntry[]>();

    jobEntries.forEach((job) => {
      const dateKey = toDateKey(new Date(job.date));
      const jobsForDate = groupedJobs.get(dateKey) || [];
      jobsForDate.push(job);
      groupedJobs.set(dateKey, jobsForDate);
    });

    groupedJobs.forEach((jobsForDate, dateKey) => {
      const positionDateKey = new Date(`${dateKey}T12:00:00`).toDateString();
      jobsForDate.sort((a, b) => {
        const positionA = jobPositions.get(`${positionDateKey}-${a.id}`) ?? 999;
        const positionB = jobPositions.get(`${positionDateKey}-${b.id}`) ?? 999;

        if (positionA !== positionB) {
          return positionA - positionB;
        }

        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });
    });

    return groupedJobs;
  }, [jobEntries, jobPositions]);

  const getJobsForDate = (date: Date) => jobsByDate.get(toDateKey(date)) || [];

  const firstJobStartMinutes = timeGridDays
    .flatMap((date) => getJobsForDate(date).map((job) => getJobTimeRange(job).start));
  const earliestJobStartMinutes = firstJobStartMinutes.length > 0 ? Math.min(...firstJobStartMinutes) : null;
  const timeGridStartHour = CALENDAR_START_HOUR;
  const timeGridHours = Array.from(
    { length: CALENDAR_END_HOUR - timeGridStartHour },
    (_, index) => timeGridStartHour + index,
  );

  useEffect(() => {
    if (viewMode === 'month' || !timeGridBodyRef.current) return;

    const firstVisibleHour = earliestJobStartMinutes === null
      ? CALENDAR_START_HOUR
      : Math.floor(earliestJobStartMinutes / 60);
    const frame = window.requestAnimationFrame(() => {
      if (timeGridBodyRef.current) {
        timeGridBodyRef.current.scrollTop = Math.max(
          0,
          (firstVisibleHour - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT,
        );
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [earliestJobStartMinutes, currentWeekStart, selectedDate, viewMode]);

  const getEventsForDate = (date: Date) => {
    const dateKey = toDateKey(date);
    return calendarEvents.filter((event) => event.startDate <= dateKey && event.endDate >= dateKey);
  };

  const handleVacationSubmit = async (event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const createdEvent = await apiService.createCalendarEvent(event);
      setCalendarEvents((previous) => [...previous, createdEvent]);
    } catch (error) {
      logger.error('Error creating vacation event:', error);
      throw error;
    }
  };

  const handleDeleteCalendarEvent = async (event: CalendarEvent) => {
    if (!window.confirm(`„${event.title}“ wirklich aus dem Kalender entfernen?`)) return;

    try {
      await apiService.deleteCalendarEvent(event.id);
      setCalendarEvents((previous) => previous.filter((item) => item.id !== event.id));
    } catch (error) {
      logger.error('Error deleting calendar event:', error);
    }
  };

  // Check if date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelectedDate = (date: Date) => date.toDateString() === selectedDate.toDateString();

  // Check if date is in current month
  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === currentDate.getMonth() && date.getFullYear() === currentDate.getFullYear();
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

  const getStatusIndicatorColor = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-400';
      case 'in-progress': return 'bg-yellow-400';
      case 'completed': return 'bg-green-500';
      case 'invoiced': return 'bg-blue-500';
      default: return 'bg-gray-400';
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
  const updateDragPointerOffset = (clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const offsetMinutes = ((clientY - rect.top) / CALENDAR_HOUR_HEIGHT) * 60;
    setDragPointerOffsetMinutes(Math.max(0, Math.min(24 * 60, offsetMinutes)));
  };

  const handleDragPointerDown = (e: React.MouseEvent<HTMLElement>) => {
    updateDragPointerOffset(e.clientY, e.currentTarget);
  };

  const handleDragStart = (e: React.DragEvent, job: JobEntry) => {
    setDraggedJob(job);
    setTimeGridDragPreview(null);
    if (e.clientY > 0) {
      updateDragPointerOffset(e.clientY, e.currentTarget as HTMLElement);
    }
    e.dataTransfer.effectAllowed = 'move';
    // Add visual feedback
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Reset visual feedback
    (e.currentTarget as HTMLElement).style.opacity = '1';
    setDraggedJob(null);
    setDragOverDate(null);
    setTimeGridDragPreview(null);
    setDragPointerOffsetMinutes(0);
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
      setTimeGridDragPreview(null);
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
    setTimeGridDragPreview(null);
    setDragPointerOffsetMinutes(0);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragOverDate(null);
    setTimeGridDragPreview(null);
    
    if (!draggedJob) return;

    // Don't allow dropping on the same date
    const jobDate = new Date(draggedJob.date);
    if (jobDate.toDateString() === targetDate.toDateString()) {
      setDraggedJob(null);
      setTimeGridDragPreview(null);
      setDragPointerOffsetMinutes(0);
      return;
    }

    try {
      // Keep the domain value as a Date; the API adapter serializes it for persistence.
      await updateJobEntry(draggedJob.id, {
        ...draggedJob,
        date: targetDate
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
      setTimeGridDragPreview(null);
      setDragPointerOffsetMinutes(0);
    }
  };

  const getSnappedTimeGridStart = (
    clientY: number,
    cellRect: DOMRect,
    dayStartMinutes: number,
    durationMinutes: number,
    pointerOffsetMinutes: number,
  ) => {
    const minutesFromDayStart = ((clientY - cellRect.top) / CALENDAR_HOUR_HEIGHT) * 60 - pointerOffsetMinutes;
    const requestedStart = dayStartMinutes + Math.round(minutesFromDayStart / 15) * 15;
    const latestStart = Math.max(0, 24 * 60 - durationMinutes);

    return Math.max(dayStartMinutes, Math.min(latestStart, requestedStart));
  };

  const handleTimeGridDragOver = (e: React.DragEvent, targetDate: Date, dayStartMinutes: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(targetDate);

    if (!draggedJob) return;

    const { start, end } = getJobTimeRange(draggedJob);
    const startMinutes = getSnappedTimeGridStart(
      e.clientY,
      (e.currentTarget as HTMLElement).getBoundingClientRect(),
      dayStartMinutes,
      Math.max(30, end - start),
      dragPointerOffsetMinutes,
    );

    setTimeGridDragPreview({
      dateKey: toDateKey(targetDate),
      startMinutes,
    });
  };

  const handleTimeGridDrop = async (e: React.DragEvent, targetDate: Date, dayStartMinutes: number) => {
    e.preventDefault();
    e.stopPropagation();

    setDragOverDate(null);
    setTimeGridDragPreview(null);

    if (!draggedJob) return;

    const { start: originalStart, end: originalEnd } = getJobTimeRange(draggedJob);
    const duration = Math.max(30, originalEnd - originalStart);
    const startMinutes = getSnappedTimeGridStart(
      e.clientY,
      (e.currentTarget as HTMLElement).getBoundingClientRect(),
      dayStartMinutes,
      duration,
      dragPointerOffsetMinutes,
    );
    const endMinutes = startMinutes + duration;
    const jobDate = new Date(draggedJob.date);
    const dateChanged = jobDate.toDateString() !== targetDate.toDateString();

    try {
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      await updateJobEntry(draggedJob.id, {
        ...draggedJob,
        date: dateString as unknown as JobEntry['date'],
        startTime: formatMinutesToTime(startMinutes, locale, company?.timeFormat),
        endTime: formatMinutesToTime(endMinutes, locale, company?.timeFormat),
      });

      if (dateChanged) {
        const newPositions = new Map(jobPositions);
        const oldDateKey = jobDate.toDateString();
        const newDateKey = targetDate.toDateString();
        const targetDayJobs = getJobsForDate(targetDate);

        newPositions.delete(`${oldDateKey}-${draggedJob.id}`);
        newPositions.set(`${newDateKey}-${draggedJob.id}`, targetDayJobs.length);
        setJobPositions(newPositions);
      }

      logger.info('Job moved via time grid drag and drop', {
        jobTitle: draggedJob.title,
        targetDate: targetDate.toLocaleDateString(locale),
        startTime: formatMinutesToTime(startMinutes, locale, company?.timeFormat),
        jobId: draggedJob.id,
      });
    } catch (error) {
      logger.error('Error updating job date and time:', error);
    } finally {
      setDraggedJob(null);
      setTimeGridDragPreview(null);
      setDragPointerOffsetMinutes(0);
    }
  };

  const getStatusLabel = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'Entwurf';
      case 'in-progress': return 'In Bearbeitung';
      case 'completed': return 'Abgeschlossen';
      case 'invoiced': return 'Abgerechnet';
      default: return status;
    }
  };

  // Double click opens the compact job summary first.
  const handleJobDoubleClick = (job: JobEntry) => {
    setPreviewingJob(job);
  };

  const handlePreviewEdit = (job: JobEntry) => {
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: terminology.work.editLabel,
        message: `Dieser ${terminology.work.singular} wurde bereits abgerechnet. Änderungen an abgerechneten ${terminology.work.plural} sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?`,
        onConfirm: () => {
          setPreviewingJob(null);
          setEditingJob(job);
          setSelectedDateForNewJob(null);
          setShowJobForm(true);
        },
        isGoBDWarning: true
      });
    } else {
      setPreviewingJob(null);
      setEditingJob(job);
      setSelectedDateForNewJob(null);
      setShowJobForm(true);
    }
  };

  // Double click handler for creating new job on a specific date
  const handleDateDoubleClick = (date: Date) => {
    setPreviewingJob(null);
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

  const handleNewEntry = () => {
    setPreviewingJob(null);
    setEditingJob(null);
    setSelectedDateForNewJob(new Date(selectedDate));
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

  const weekDays = [
    { short: 'Mo', long: 'Montag' },
    { short: 'Di', long: 'Dienstag' },
    { short: 'Mi', long: 'Mittwoch' },
    { short: 'Do', long: 'Donnerstag' },
    { short: 'Fr', long: 'Freitag' },
    { short: 'Sa', long: 'Samstag' },
    { short: 'So', long: 'Sonntag' },
  ];

  const currentMonthLong = currentDate.toLocaleDateString(locale, { month: 'long' });
  const currentMonthShort = currentDate.toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '');
  const currentMonthLabel = `${currentMonthLong} ${currentDate.getFullYear()}`;
  const currentMonthShortLabel = `${currentMonthShort} ${currentDate.getFullYear()}`;

  const monthPicker = (
    <div ref={datePickerRef} className="relative w-fit max-w-full justify-self-center">
      <button
        type="button"
        onClick={openDatePicker}
        className="min-h-0 inline-flex h-11 w-fit max-w-full min-w-0 items-center justify-center gap-1 rounded-lg px-3 text-center text-lg font-semibold capitalize text-gray-900 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-primary-custom lg:text-xl"
        aria-label="Monat und Jahr auswählen"
        aria-expanded={showDatePicker}
      >
        <span className="truncate md:hidden">{currentMonthShortLabel}</span>
        <span className="hidden truncate md:inline">{currentMonthLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${showDatePicker ? 'rotate-180' : ''}`} />
      </button>

      {showDatePicker && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => shiftDatePickerPeriod(-1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100"
              aria-label="Vorheriger Zeitraum"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDatePickerView((view) => view === 'months' ? 'years' : 'months')}
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-center text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            >
              {datePickerView === 'months'
                ? datePickerYear
                : `${datePickerYear - 5}–${datePickerYear + 6}`}
            </button>
            <button
              type="button"
              onClick={() => shiftDatePickerPeriod(1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100"
              aria-label="Nächster Zeitraum"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {datePickerView === 'months' ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, month) => {
                const isActive = currentDate.getFullYear() === datePickerYear && currentDate.getMonth() === month;

                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => selectMonth(month)}
                    className={`h-9 rounded-md px-2 text-sm capitalize transition-colors ${isActive ? 'bg-primary-custom text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                    aria-pressed={isActive}
                  >
                    {new Date(datePickerYear, month, 1).toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '')}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, index) => datePickerYear - 5 + index).map((year) => {
                const isActive = currentDate.getFullYear() === year;

                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => selectPickerYear(year)}
                    className={`h-9 rounded-md px-2 text-sm transition-colors ${isActive ? 'bg-primary-custom text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                    aria-pressed={isActive}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3 lg:space-y-0">
      {/* Header */}
      <div className="p-1 lg:p-2">
        <PageHeader icon={CalendarIcon} title="Kalender" singleRow>
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleNewEntry}
          className="order-3 min-h-0 inline-flex h-10 items-center gap-1.5 rounded-lg border border-primary-custom px-2 text-sm text-primary-custom transition-colors hover:bg-primary-custom/10 sm:px-4"
          aria-label="Neuen Eintrag erstellen"
          title="Neuen Eintrag erstellen"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Neu</span>
        </button>
        <button
          type="button"
          onClick={() => setShowShareDialog(true)}
          className="order-2 min-h-0 inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:px-3"
          aria-label="Kalender teilen"
          title="Kalender teilen"
        >
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">Teilen</span>
        </button>
        <div className="relative order-1 search-container">
          {isSearchOpen ? (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={terminology.work.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.trim().length > 0);
              }}
              onFocus={() => setShowSearchResults(searchQuery.trim().length > 0)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearchQuery('');
                  setShowSearchResults(false);
                  setIsSearchOpen(false);
                }
              }}
              autoFocus
              className="h-10 pl-10 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent w-full sm:w-64 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setShowSearchResults(false);
                setIsSearchOpen(false);
              }}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 hover:text-gray-600"
              aria-label="Suche schließen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:border-transparent focus:ring-2 focus:ring-primary-custom"
              aria-label={terminology.work.searchPlaceholder}
              title={terminology.work.searchPlaceholder}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          
          {/* Search Results Dropdown */}
          {isSearchOpen && showSearchResults && searchResults.length > 0 && (
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
                            <span>{formatDate(jobDate, locale, company?.dateFormat)}</span>
                            <Clock className="h-3 w-3 ml-3 mr-1" />
                            <span>{formatNumber(totalHours, locale, company?.numberFormat, 1)}h</span>
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
                        {getStatusLabel(job.status)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* No Results Message */}
          {isSearchOpen && showSearchResults && searchQuery.trim() && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4 text-center text-gray-500">
              {terminology.work.noResults}
            </div>
          )}
        </div>
        </div>
        </PageHeader>
      </div>

      {/* Calendar Controls */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 w-full grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2 sm:w-auto sm:flex-1 lg:max-w-[22rem]">
            <button
              type="button"
              onClick={navigatePrevious}
              className="min-h-0 inline-flex h-10 w-10 items-center justify-center border border-gray-300 p-1.5 hover:bg-gray-50 rounded-lg transition-colors"
              title="Vorheriger Zeitraum"
            >
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>

            {viewMode === 'month' ? (
              monthPicker
            ) : (
              <h2 className="min-w-0 truncate px-1 text-center text-base font-semibold capitalize text-gray-900 lg:text-lg">
                {viewMode === 'week' || viewMode === 'workweek'
                  ? `KW ${getCalendarWeek(currentWeekStart)} · ${viewMode === 'workweek' ? workWeekRange : weekRange}`
                  : selectedDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h2>
            )}

            <button
              type="button"
              onClick={navigateNext}
              className="min-h-0 inline-flex h-10 w-10 items-center justify-center border border-gray-300 p-1.5 hover:bg-gray-50 rounded-lg transition-colors"
              title="Nächster Zeitraum"
            >
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>

          </div>

          <div className="flex h-11 w-full min-w-0 items-center justify-end gap-1 sm:w-auto">
            <div className="flex h-11 min-w-0 flex-1 items-stretch rounded-lg border border-gray-200 bg-gray-50 sm:flex-none" role="group" aria-label="Kalenderansicht">
              {([
                ['day', 'Tag'],
                ['week', 'Kalenderwoche'],
                ['workweek', 'Arbeitswoche'],
                ['month', 'Monat'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => changeViewMode(mode)}
                  className={`min-h-0 inline-flex h-full min-w-0 flex-1 items-center justify-center rounded-md px-1 text-xs font-medium transition-colors sm:flex-none sm:px-3 sm:text-sm ${viewMode === mode ? 'bg-primary-custom text-white shadow-sm' : 'text-gray-600 hover:bg-white'}`}
                >
                  <span className="sm:hidden">{mode === 'day' ? 'T' : mode === 'week' ? 'KW' : mode === 'workweek' ? 'AW' : 'M'}</span>
                  <span className="hidden sm:inline xl:hidden">{mode === 'week' ? 'KW' : mode === 'workweek' ? 'AW' : label}</span>
                  <span className="hidden xl:inline">{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={goToToday}
              className="min-h-0 h-11 shrink-0 rounded-lg bg-primary-custom px-2 text-sm text-white transition-colors hover:bg-primary-custom/90 sm:px-4"
            >
              Heute
            </button>
          </div>
        </div>

        {/* Desktop Calendar Grid */}
        {viewMode === 'month' && <div className="mt-3 overflow-x-auto">
          <div
            ref={monthGridRef}
            className="grid h-[calc(100vh-270px)] min-h-[24rem] w-full min-w-0 grid-cols-[40px_repeat(7,minmax(0,1fr))] overflow-hidden rounded-xl border border-slate-200 sm:min-h-0"
            style={{ gridTemplateRows: `56px repeat(${calendarDays.length / 7}, minmax(0, 1fr))` }}
          >
            {/* Week day headers */}
            <div className="border-b border-r border-slate-200 bg-slate-50 p-1 text-center text-xs font-semibold text-slate-600">
              KW
            </div>
            {weekDays.map((day) => (
              <div
                key={day.short}
                className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center text-sm font-semibold text-slate-600 lg:p-3 lg:text-base"
              >
                <span className="lg:hidden">{day.short}</span>
                <span className="hidden lg:inline">{day.long}</span>
              </div>
            ))}
            
            {/* Calendar days */}
            {calendarDays.map((date, index) => {
              const dayJobs = getJobsForDate(date);
              const isDayToday = isToday(date);
              const isInCurrentMonth = isCurrentMonth(date);
              const isDragOver = dragOverDate && date.toDateString() === dragOverDate.toDateString();
              
              return (
                <React.Fragment key={date.toISOString()}>
                  {index % 7 === 0 && (
                    <div className="flex h-full min-h-0 items-center justify-center border-b border-r border-slate-200 bg-white p-1 text-xs font-semibold text-primary-custom">
                      {getCalendarWeek(date)}
                    </div>
                  )}
                <div
                  onClick={() => selectCalendarDate(date)}
                  onDoubleClick={() => handleDateDoubleClick(date)}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, date)}
                  className={`
                    h-full min-w-0 min-h-0 overflow-hidden border-b border-r border-slate-200
                    ${isSelectedDate(date) ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}
                    ${!isInCurrentMonth ? 'bg-slate-50 text-slate-400' : ''}
                    ${isSelectedDate(date) ? 'z-10 bg-blue-50' : ''}
                    ${isDragOver ? 'bg-blue-100 border-blue-400 border-2 shadow-md' : ''}
                    transition-all duration-200 relative flex flex-col
                  `}
                >
                  {/* Date header - clickable area for creating new jobs */}
                  <div 
                    className={`
                      px-1 py-1.5 sm:px-3
                    `}
                    title={`Doppelklick zum Erstellen eines neuen ${terminology.work.singular}`}
                  >
                    <div className="flex items-start">
                      <span className={`
                        inline-flex h-6 min-w-6 items-center justify-center rounded-full text-sm font-medium sm:h-7 sm:min-w-7 sm:text-base
                        ${isDayToday ? 'border border-primary-custom font-semibold text-primary-custom' : isSelectedDate(date) ? 'font-semibold text-primary-custom' : ''}
                        ${!isInCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                      `}>
                      {date.getDate()}
                      </span>
                    </div>
                  </div>
                  
                  {/* Jobs area */}
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-transparent p-2">
                    {(() => {
                      const isExpanded = isDateExpanded(date);
                      const dayEvents = getEventsForDate(date);
                      const totalEntries = dayJobs.length + dayEvents.length;
                      const density = getCalendarDensity(monthCellSize.width, monthCellSize.height, totalEntries);
                      const maxVisibleEntries = isExpanded ? totalEntries : getMaxVisibleEntries(density, monthCellSize.height);
                      const hasMoreEntries = !isExpanded && totalEntries > maxVisibleEntries;
                      const visibleEntryLimit = hasMoreEntries ? Math.max(1, maxVisibleEntries - 1) : maxVisibleEntries;
                      const eventsToShow = dayEvents.slice(0, Math.min(dayEvents.length, visibleEntryLimit));
                      const jobsToShow = dayJobs.slice(0, Math.max(0, visibleEntryLimit - eventsToShow.length));
                      const hiddenEntryCount = totalEntries - eventsToShow.length - jobsToShow.length;
                      
                      return (
                        <>
                          {eventsToShow.map((calendarEvent) => {
                            const isMultiDayEvent = calendarEvent.startDate !== calendarEvent.endDate;
                            const isEventStart = calendarEvent.startDate === toDateKey(date);
                            const isEventEnd = calendarEvent.endDate === toDateKey(date);

                            return density === 'indicator' || (density === 'minimal' && isMultiDayEvent) ? (
                              <div
                                key={calendarEvent.id}
                                className={`-mx-2 h-2 bg-purple-400 ${isEventStart ? 'rounded-l-full' : ''} ${isEventEnd ? 'rounded-r-full' : ''}`}
                                title={`${calendarEvent.title} · ${calendarEvent.startDate} bis ${calendarEvent.endDate}`}
                              />
                            ) : (
                              <div
                                key={calendarEvent.id}
                                className="flex items-center justify-between gap-1 rounded border border-purple-200 bg-purple-100 px-1.5 py-1 text-xs text-purple-800"
                                title={`${calendarEvent.title} · ${calendarEvent.startDate} bis ${calendarEvent.endDate}`}
                              >
                                <div className="flex min-w-0 items-center gap-1">
                                  <CalendarIcon className="h-3 w-3 shrink-0" />
                                  <span className="truncate font-medium">{calendarEvent.title}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteCalendarEvent(calendarEvent);
                                  }}
                                  className="shrink-0 rounded p-0.5 text-purple-700 hover:bg-purple-200"
                                  title="Urlaub entfernen"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
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
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    handleJobDoubleClick(job);
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onDrop={(e) => handleJobDrop(e, date, job.id)}
                                  className={`
                                    cursor-move transition-all duration-150
                                    ${density === 'indicator'
                                      ? `h-2 w-2 rounded-full ${getStatusIndicatorColor(job.status)}`
                                      : `text-xs rounded border p-1 ${getStatusColor(job.status)}`}
                                    ${job.status === 'invoiced' ? 'cursor-not-allowed opacity-75' : density !== 'indicator' ? 'hover:shadow-sm' : ''}
                                    ${draggedJob && draggedJob.id !== job.id && 
                                      new Date(draggedJob.date).toDateString() === date.toDateString() ? 
                                      'border-blue-300 border-dashed' : ''}
                                    ${highlightedJobId === job.id ? 'ring-2 ring-red-500 bg-red-100 border-red-500' : ''}
                                  `}
                                  title={`${job.title} - ${customer?.name || job.customerName} - ${formatNumber(totalHours, company.locale, company.numberFormat, 1)}h - Doppelklick zum Bearbeiten - Ziehen zum Umordnen`}
                                >
                                {density !== 'indicator' && (
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center">
                                      {density !== 'minimal' && job.priority && (
                                        <AlertTriangle className={`h-3 w-3 mr-1 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                                      )}
                                      <span className="truncate font-medium">
                                        {job.title}
                                      </span>
                                      {density === 'spacious' && job.attachments && job.attachments.length > 0 && (
                                      <span title="Anhänge vorhanden"><FileText className="h-3 w-3 ml-1 flex-shrink-0 text-gray-400" /></span>
                                      )}
                                    </div>
                                    {density !== 'minimal' && <div className="flex items-center mt-1 text-xs opacity-75">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0" />
                                      <span className="truncate">{customer?.name || job.customerName}</span>
                                    </div>}
                                    {density === 'spacious' && job.jobNumber && (
                                      <div className="flex items-center mt-1 text-xs opacity-75">
                                        <Hash className="h-3 w-3 mr-1 flex-shrink-0" />
                                        <span className="truncate">{job.jobNumber}</span>
                                      </div>
                                    )}
                                    {density === 'spacious' && job.externalJobNumber && (
                                      <div className="flex items-center mt-1 text-xs opacity-75">
                                        <ExternalLink className="h-3 w-3 mr-1 flex-shrink-0" />
                                        <span className="truncate">{job.externalJobNumber}</span>
                                      </div>
                                    )}
                                    {density !== 'minimal' && <div className="flex items-center mt-1 text-xs opacity-75">
                                      <Clock className="h-3 w-3 mr-1 flex-shrink-0" />
                                      <span>{formatNumber(totalHours, locale, company?.numberFormat, 1)}h</span>
                                    </div>}
                                  </div>
                                </div>
                                )}
                                </div>
                              </React.Fragment>
                            );
                          })}
                          
                          {/* Show toggle button if more jobs exist */}
                          {hiddenEntryCount > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandedDate(date);
                              }}
                              className="min-h-0 h-5 w-full rounded text-center text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                              title={isExpanded ? "Weniger anzeigen" : "Alle anzeigen"}
                            >
                              {isExpanded ? 
                                `Weniger anzeigen` : 
                                `+${hiddenEntryCount} weitere`
                              }
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {isSelectedDate(date) && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-30 rounded-lg border-2"
                      style={{ borderColor: 'var(--primary-color)' }}
                    />
                  )}
                </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        }

        {/* Desktop time grid for day, calendar week and work week */}
        {(viewMode === 'day' || viewMode === 'week' || viewMode === 'workweek') && (
          <div className="mt-3 hidden overflow-hidden rounded-lg border border-gray-300 lg:block">
            <div
              className="sticky top-0 z-30 grid w-full min-w-0 bg-white pr-[6px]"
              style={{ gridTemplateColumns: '52px minmax(0, 1fr)' }}
            >
                <div className="border-b border-r border-gray-300 bg-gray-100 p-1 text-center text-[10px] font-semibold uppercase text-gray-600">
                  Zeit
                </div>
                <div
                  className="grid min-w-0"
                  style={{ gridTemplateColumns: `repeat(${timeGridDays.length}, minmax(0, 1fr))` }}
                >
                  {timeGridDays.map((date) => (
                    <div
                      key={date.toISOString()}
                      onClick={() => selectCalendarDate(date)}
                      onDoubleClick={() => handleDateDoubleClick(date)}
                      className={`flex min-w-0 cursor-pointer flex-col items-center justify-center border-b border-r border-gray-300 p-2 text-center ${
                        isToday(date) ? 'bg-primary-custom/15 text-primary-custom' : 'bg-gray-100 text-gray-700'
                      } ${isSelectedDate(date) ? 'ring-2 ring-inset ring-primary-custom' : ''}`}
                    >
                      <div className="truncate text-sm font-semibold">
                        <span className="xl:hidden">{date.toLocaleDateString(locale, { weekday: 'short' })}</span>
                        <span className="hidden xl:inline">{date.toLocaleDateString(locale, { weekday: 'long' })}</span>
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">
                        {date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  ))}
                </div>
            </div>

            <div
              ref={timeGridBodyRef}
              className="h-[calc(100vh-300px)] min-h-[24rem] overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
            >
              <div
                className="grid w-full min-w-0"
                style={{ gridTemplateColumns: '52px minmax(0, 1fr)' }}
              >

                <div className="bg-gray-50">
                  {timeGridHours.map((hour) => (
                    <div
                      key={hour}
                      className="border-b border-r border-gray-200 px-1 pt-1 text-right text-[10px] font-medium text-gray-500"
                      style={{ height: `${CALENDAR_HOUR_HEIGHT}px` }}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${timeGridDays.length}, minmax(0, 1fr))` }}
                >
                  {timeGridDays.map((date) => {
                    const dayJobs = getJobsForDate(date);
                    const dayEvents = getEventsForDate(date);
                    const dayStartMinutes = timeGridStartHour * 60;
                    const dayEndMinutes = CALENDAR_END_HOUR * 60;
                    const isPreviewDay = Boolean(
                      draggedJob && timeGridDragPreview?.dateKey === toDateKey(date),
                    );
                    const previewDuration = draggedJob
                      ? Math.max(30, getJobTimeRange(draggedJob).end - getJobTimeRange(draggedJob).start)
                      : 0;

                    return (
                      <div
                        key={date.toISOString()}
                        onDragOver={(event) => handleTimeGridDragOver(event, date, dayStartMinutes)}
                        onDragLeave={handleDragLeave}
                        onDrop={(event) => handleTimeGridDrop(event, date, dayStartMinutes)}
                        className={`relative border-b border-r border-gray-300 ${
                          isToday(date) ? 'bg-primary-custom/5' : 'bg-white'
                        } ${isSelectedDate(date) ? 'bg-blue-50/30' : ''} ${
                          dragOverDate && date.toDateString() === dragOverDate.toDateString()
                            ? 'bg-blue-100'
                            : ''
                        }`}
                        style={{
                          height: `${timeGridHours.length * CALENDAR_HOUR_HEIGHT}px`,
                          backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 55px, #e5e7eb 55px, #e5e7eb 56px)',
                        }}
                      >
                        {isPreviewDay && draggedJob && timeGridDragPreview && (
                          <div
                            className="pointer-events-none absolute left-1 right-1 z-30 overflow-hidden rounded border-2 border-dashed border-primary-custom bg-blue-100/80 p-1.5 text-xs text-primary-custom shadow-sm"
                            style={{
                              top: `${((timeGridDragPreview.startMinutes - dayStartMinutes) / 60) * CALENDAR_HOUR_HEIGHT}px`,
                              height: `${Math.max(32, (previewDuration / 60) * CALENDAR_HOUR_HEIGHT)}px`,
                            }}
                          >
                            <div className="truncate font-semibold">{draggedJob.title}</div>
                            <div className="truncate">
                              {formatMinutesToTime(timeGridDragPreview.startMinutes, locale, company?.timeFormat)}–{formatMinutesToTime(timeGridDragPreview.startMinutes + previewDuration, locale, company?.timeFormat)}
                            </div>
                          </div>
                        )}
                        {dayEvents.map((calendarEvent, eventIndex) => (
                          <div
                            key={calendarEvent.id}
                            className="absolute left-1 right-1 z-10 flex h-7 items-center gap-1 overflow-hidden rounded border border-purple-200 bg-purple-100 px-1.5 text-xs text-purple-800"
                            style={{ top: `${4 + eventIndex * 30}px` }}
                            title={`${calendarEvent.title} · ${calendarEvent.startDate} bis ${calendarEvent.endDate}`}
                          >
                            <CalendarIcon className="h-3 w-3 shrink-0" />
                            <span className="truncate font-medium">{calendarEvent.title}</span>
                          </div>
                        ))}
                        {dayJobs.map((job) => {
                          const customer = customers.find((item) => item.id === job.customerId);
                          const { start, end } = getJobTimeRange(job);
                          const jobTimeLabel = getJobTimeLabel(job) || `${formatMinutesToTime(start, locale, company?.timeFormat)}–${formatMinutesToTime(end, locale, company?.timeFormat)}`;
                          const visibleStart = Math.max(dayStartMinutes, start);
                          const visibleEnd = Math.min(dayEndMinutes, end);

                          if (visibleEnd <= visibleStart) return null;

                          return (
                            <div
                              key={job.id}
                              draggable={job.status !== 'invoiced'}
                              onMouseDown={handleDragPointerDown}
                              onDragStart={(event) => handleDragStart(event, job)}
                              onDragEnd={handleDragEnd}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                handleJobDoubleClick(job);
                              }}
                              className={`absolute left-1 right-1 z-20 cursor-pointer overflow-hidden rounded border p-1.5 text-xs shadow-sm ${getStatusColor(job.status)} ${
                                highlightedJobId === job.id ? 'ring-2 ring-red-500' : ''
                              }`}
                              style={{
                                top: `${((visibleStart - dayStartMinutes) / 60) * CALENDAR_HOUR_HEIGHT}px`,
                                height: `${Math.max(32, ((visibleEnd - visibleStart) / 60) * CALENDAR_HOUR_HEIGHT)}px`,
                              }}
                              title={`${job.title} · ${customer?.name || job.customerName} · ${jobTimeLabel}`}
                            >
                              <div className="truncate font-semibold">{job.title}</div>
                              <div className="truncate opacity-80">{customer?.name || job.customerName}</div>
                              <div className="mt-0.5 flex items-center gap-1 opacity-80">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>{jobTimeLabel}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                })}
              </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Week View */}
        {viewMode !== 'month' && <div className="mt-3 space-y-3 lg:hidden">
          {(viewMode === 'day' ? [selectedDate] : viewMode === 'workweek' ? currentWeekDays.slice(0, 5) : currentWeekDays).map((date, index) => {
            const dayJobs = getJobsForDate(date);
            const dayEvents = getEventsForDate(date);
            const isDayToday = isToday(date);
            const isDragOver = dragOverDate && date.toDateString() === dragOverDate.toDateString();
            const dayName = date.toLocaleDateString(locale, { weekday: 'short' });
            const dayNameLong = date.toLocaleDateString(locale, { weekday: 'long' });
            
            return (
              <div
                key={index}
                onDragOver={(e) => handleDragOver(e, date)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, date)}
                className={`
                  border border-gray-300 rounded-lg overflow-hidden
                  ${isDayToday ? 'border-primary-custom bg-primary-custom/5' : 'bg-white'}
                  ${isSelectedDate(date) ? 'ring-2 ring-inset ring-primary-custom' : ''}
                  ${isDragOver ? 'bg-blue-100 border-blue-400 border-2 shadow-md' : ''}
                  transition-all duration-200
                `}
              >
                {/* Date header */}
                <div 
                  className={`
                    p-3 border-b border-gray-300 cursor-pointer hover:bg-gray-100
                    ${isDayToday ? 'bg-primary-custom/20' : isSelectedDate(date) ? 'bg-primary-custom/10' : 'bg-gray-100'}
                    transition-colors duration-200
                  `}
                  onDoubleClick={() => handleDateDoubleClick(date)}
                  onClick={() => selectCalendarDate(date)}
                    title={`Doppelklick zum Erstellen eines neuen ${terminology.work.singular}`}
                >
                  <div className="relative flex items-center justify-center text-center">
                    <div className={`
                      font-medium
                      ${isDayToday ? 'text-primary-custom' : 'text-gray-900'}
                    `}>
                      <span className="sm:hidden">{dayName}</span>
                      <span className="hidden sm:inline">{dayNameLong}</span>
                      {`, ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.`}
                    </div>
                    {dayJobs.length + dayEvents.length > 0 && (
                      <div className="absolute right-0 text-xs text-gray-500">
                        {dayJobs.length + dayEvents.length} Eintrag{dayJobs.length + dayEvents.length > 1 ? 'e' : ''}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Jobs list */}
                <div className="p-3 space-y-2">
                  {dayEvents.map((calendarEvent) => (
                    <div
                      key={calendarEvent.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-purple-200 bg-purple-100 p-2 text-sm text-purple-800"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <CalendarIcon className="h-4 w-4 shrink-0" />
                        <span className="truncate font-medium">{calendarEvent.title}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCalendarEvent(calendarEvent)}
                        className="shrink-0 rounded p-1 text-purple-700 hover:bg-purple-200"
                        title="Urlaub entfernen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {dayJobs.length === 0 && dayEvents.length === 0 ? (
                    <div className="text-center py-4 text-gray-400 text-sm">
                      Keine {terminology.work.plural}
                    </div>
                  ) : (
                    dayJobs.map((job, jobIndex) => {
                      const customer = customers.find(c => c.id === job.customerId);
                      const totalHours = calculateTotalHours(job);
                      const jobTimeLabel = getJobTimeLabel(job);
                      
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
                            title={`${job.title} - ${customer?.name || job.customerName} - ${formatNumber(totalHours, company.locale, company.numberFormat, 1)}h - Doppelklick zum Bearbeiten - Ziehen zum Umordnen`}
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
                                  <span title="Anhänge vorhanden"><FileText className="h-4 w-4 ml-2 flex-shrink-0 text-gray-400" /></span>
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
                                <span>{jobTimeLabel ? `${jobTimeLabel} · ` : ''}{formatNumber(totalHours, locale, company?.numberFormat, 1)}h</span>
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
        }

        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Legende</h4>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
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
            <div className="flex items-center">
              <div className="w-3 h-3 rounded bg-purple-100 border border-purple-200 mr-2"></div>
              <span className="text-gray-600">Urlaub</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            <p>• Ziehen Sie {terminology.work.plural} per Drag &amp; Drop, um das Datum zu ändern</p>
            <p>• Ziehen Sie {terminology.work.plural} innerhalb eines Tages, um die Reihenfolge zu ändern</p>
            <p>• Doppelklicken Sie auf einen {terminology.work.singular}, um die Übersicht zu öffnen</p>
            <p>• Doppelklicken Sie auf das Datum, um einen neuen {terminology.work.singular} zu erstellen</p>
            <p>• Abgerechnete {terminology.work.plural} können nicht verschoben werden</p>
          </div>
        </div>
      </div>

      {/* Job summary modal */}
      {previewingJob && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewingJob(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-job-preview-title"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {terminology.work.managementLabel}
                </p>
                <h2 id="calendar-job-preview-title" className="mt-1 truncate text-lg font-semibold text-gray-900">
                  {previewingJob.title}
                </h2>
                {previewingJob.jobNumber && (
                  <p className="mt-1 text-sm text-gray-500">{previewingJob.jobNumber}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewingJob(null)}
                className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label={`${terminology.work.singular}-Übersicht schließen`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(previewingJob.status)}`}>
                {getStatusLabel(previewingJob.status)}
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500">{terminology.entity.singular}</dt>
                  <dd className="mt-1 truncate font-medium text-gray-900">
                    {customers.find((customer) => customer.id === previewingJob.customerId)?.name || previewingJob.customerName}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Datum</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {formatDate(new Date(previewingJob.date), locale, company?.dateFormat)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Zeit</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {getJobTimeLabel(previewingJob) || 'Keine Zeit hinterlegt'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Arbeitszeit</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {formatNumber(calculateTotalHours(previewingJob), locale, company?.numberFormat, 1)} h
                  </dd>
                </div>
                {previewingJob.externalJobNumber && (
                  <div>
                    <dt className="text-gray-500">Externe {terminology.work.numberLabel}</dt>
                    <dd className="mt-1 truncate font-medium text-gray-900">{previewingJob.externalJobNumber}</dd>
                  </div>
                )}
                {previewingJob.location && (
                  <div>
                    <dt className="text-gray-500">Ausführungsort</dt>
                    <dd className="mt-1 truncate font-medium text-gray-900">{previewingJob.location}</dd>
                  </div>
                )}
              </dl>

              {previewingJob.description && (
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-700">Beschreibung</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">
                    {previewingJob.description}
                  </p>
                </div>
              )}

              {previewingJob.notes && (
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-700">Notizen</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">
                    {previewingJob.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPreviewingJob(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Schließen
              </button>
              <button
                type="button"
                onClick={() => handlePreviewEdit(previewingJob)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-custom/90"
              >
                <Edit className="h-4 w-4" />
                Bearbeiten
              </button>
            </div>
          </div>
        </div>
      )}

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
              onSubmitVacation={handleVacationSubmit}
              onCreateCustomer={() => {
                setShowCustomerForm(true);
              }}
              onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
              onNavigateToSettings={() => onNavigate && onNavigate('settings')}
            />
          </div>
        </div>
      )}

      {/* Calendar sharing preparation */}
      {showShareDialog && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowShareDialog(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-share-title"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-primary-custom" />
                <h3 id="calendar-share-title" className="text-lg font-semibold text-gray-900">
                  Kalender teilen
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShareDialog(false)}
                className="min-h-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Dialog schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-medium">Kalender abonnieren</p>
              <p className="mt-1 text-blue-800">
                Die Kalenderfreigabe wird vorbereitet. Sobald der persönliche Abonnement-Link eingerichtet ist, kann er hier kopiert oder geteilt werden.
              </p>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="calendar-subscription-link">
                Abonnement-Link
              </label>
              <input
                id="calendar-subscription-link"
                type="text"
                readOnly
                disabled
                value="Nach Einrichtung der Kalenderfreigabe verfügbar"
                className="h-10 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm text-gray-400"
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowShareDialog(false)}
                className="min-h-0 rounded-lg bg-primary-custom px-4 py-2 text-sm text-white transition-colors hover:bg-primary-custom/90"
              >
                Schließen
              </button>
            </div>
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
              {terminology.entity.newLabel}
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
                  {terminology.entity.createLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
