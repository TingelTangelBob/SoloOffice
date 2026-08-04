/**
 * Frontend logging system with configurable levels
 * Supports: ERROR, WARN, INFO, DEBUG
 * Environment-aware: Production vs Development
 */

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

interface LogMeta {
  [key: string]: unknown;
}

type StoredError = Record<string, unknown>;

function normalizeMeta(value: unknown): LogMeta | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) {
    return { error: value.message, stack: value.stack };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as LogMeta;
  }
  return { detail: value };
}

declare global {
  interface Window {
    logger?: FrontendLogger;
  }
}

class FrontendLogger {
  private levels: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
  };
  
  private currentLevel: number;
  
  // Color styles for browser console
  private styles: Record<LogLevel, string> = {
    ERROR: 'color: #ff4444; font-weight: bold',
    WARN: 'color: #ffaa00; font-weight: bold', 
    INFO: 'color: #00aaff; font-weight: bold',
    DEBUG: 'color: #00aa00; font-weight: bold'
  };

  constructor() {
    this.currentLevel = this.getCurrentLevel();
  }
  
  private getCurrentLevel(): number {
    // Check for explicit log level in localStorage (for debugging)
    const storedLevel = localStorage.getItem('LOG_LEVEL');
    if (storedLevel && Object.prototype.hasOwnProperty.call(this.levels, storedLevel)) {
      return this.levels[storedLevel as LogLevel];
    }
    
    // Set level based on environment
    const isDev = import.meta.env.DEV;
    const isProd = import.meta.env.PROD;
    
    if (isProd) {
      return this.levels.ERROR; // Only errors in production
    } else if (isDev) {
      return this.levels.DEBUG; // All levels in development
    } else {
      return this.levels.INFO; // Default to INFO
    }
  }
  
  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const normalizedMeta = normalizeMeta(meta);
    const timestamp = new Date().toISOString();
    const metaStr = normalizedMeta && Object.keys(normalizedMeta).length > 0
      ? ` ${JSON.stringify(normalizedMeta)}`
      : '';
    
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  }
  
  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (this.levels[level] <= this.currentLevel) {
      const normalizedMeta = normalizeMeta(meta);
      const formattedMessage = this.formatMessage(level, message, normalizedMeta);
      const style = this.styles[level];
      
      // Use appropriate console method with styling
      switch (level) {
        case 'ERROR':
          console.error(`%c${formattedMessage}`, style, meta);
          // Send errors to monitoring service in production
          if (import.meta.env.PROD) {
            this.sendToMonitoring('error', message, normalizedMeta);
          }
          break;
        case 'WARN':
          console.warn(`%c${formattedMessage}`, style, meta);
          break;
        case 'INFO':
          console.info(`%c${formattedMessage}`, style, meta);
          break;
        case 'DEBUG':
        default:
          console.log(`%c${formattedMessage}`, style, meta);
          break;
      }
    }
  }
  
  // Send critical errors to monitoring (placeholder for future implementation)
  private sendToMonitoring(level: string, message: string, meta?: LogMeta): void {
    // TODO: Integrate with monitoring service (Sentry, LogRocket, etc.)
    // For now, just store in sessionStorage for debugging
    try {
      const errors = JSON.parse(sessionStorage.getItem('app_errors') || '[]');
      errors.push({
        timestamp: new Date().toISOString(),
        level,
        message,
        meta,
        url: window.location.href,
        userAgent: navigator.userAgent
      });
      
      // Keep only last 50 errors
      const recentErrors = errors.slice(-50);
      sessionStorage.setItem('app_errors', JSON.stringify(recentErrors));
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }
  
  // Convenience methods
  error(message: string, meta?: unknown): void {
    this.log('ERROR', message, meta);
  }
  
  warn(message: string, meta?: unknown): void {
    this.log('WARN', message, meta);
  }
  
  info(message: string, meta?: unknown): void {
    this.log('INFO', message, meta);
  }
  
  debug(message: string, meta?: unknown): void {
    this.log('DEBUG', message, meta);
  }
  
  // Special method for API calls
  api(method: string, url: string, status?: number, data?: unknown, error?: Error): void {
    const meta: LogMeta = {
      method: method.toUpperCase(),
      url,
      status,
      data: data ? (typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data) : undefined
    };
    
    if (error) {
      meta.error = error.message;
      this.error(`API ${method.toUpperCase()} ${url} failed`, meta);
    } else if (status && status >= 400) {
      this.warn(`API ${method.toUpperCase()} ${url} returned ${status}`, meta);
    } else {
      this.debug(`API ${method.toUpperCase()} ${url} success`, meta);
    }
  }
  
  // Special method for component lifecycle
  component(componentName: string, action: string, data?: unknown): void {
    this.debug(`Component ${componentName}: ${action}`, data ? { data } : undefined);
  }
  
  // Method to temporarily change log level (useful for debugging)
  setLogLevel(level: LogLevel): void {
    this.currentLevel = this.levels[level];
    localStorage.setItem('LOG_LEVEL', level);
    this.info(`Log level changed to ${level}`);
  }
  
  // Get stored errors for debugging
  getStoredErrors(): StoredError[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('app_errors') || '[]') as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is StoredError => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
        : [];
    } catch {
      return [];
    }
  }
  
  // Clear stored errors
  clearStoredErrors(): void {
    sessionStorage.removeItem('app_errors');
    this.info('Stored errors cleared');
  }
}

// Create singleton instance
const logger = new FrontendLogger();

// Make logger available in window for debugging
if (typeof window !== 'undefined') {
  window.logger = logger;
}

export default logger;
