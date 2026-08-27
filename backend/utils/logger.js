/**
 * Professional logging system with configurable levels
 * Supports: ERROR, WARN, INFO, DEBUG
 * Environment-aware: Production vs Development
 */

import { getRequestContext } from './requestContext.js';

class Logger {
  constructor() {
    this.levels = {
      ERROR: 0,
      WARN: 1, 
      INFO: 2,
      DEBUG: 3
    };
    
    // Set log level based on environment
    this.currentLevel = this.getCurrentLevel();
    
    // Color codes for better readability in development
    this.colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow  
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[32m', // Green
      RESET: '\x1b[0m'   // Reset
    };
  }
  
  getCurrentLevel() {
    const env = process.env.NODE_ENV || 'development';
    const configLevel = process.env.LOG_LEVEL;
    
    if (configLevel && this.levels.hasOwnProperty(configLevel.toUpperCase())) {
      return this.levels[configLevel.toUpperCase()];
    }
    
    // Default levels by environment
    switch (env) {
      case 'production':
        return this.levels.WARN; // Only WARN and ERROR in production
      case 'test':
        return this.levels.ERROR; // Only ERROR in tests
      default:
        return this.levels.DEBUG; // All levels in development
    }
  }
  
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const levelStr = level.padEnd(5);
    const requestId = getRequestContext()?.requestId;
    
    // Create base log object
    const logObj = {
      timestamp,
      level,
      message,
      ...(requestId ? { requestId } : {}),
      ...meta
    };
    
    // In production, return JSON for structured logging
    if (process.env.NODE_ENV === 'production') {
      return JSON.stringify(logObj);
    }
    
    // In development, return colorized human-readable format
    const color = this.colors[level];
    const reset = this.colors.RESET;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    
    return `${color}[${timestamp}] ${levelStr}${reset} ${message}${metaStr}`;
  }
  
  log(level, message, meta = {}) {
    if (this.levels[level] <= this.currentLevel) {
      const formattedMessage = this.formatMessage(level, message, meta);
      
      // Use appropriate console method based on level
      switch (level) {
        case 'ERROR':
          console.error(formattedMessage);
          break;
        case 'WARN':
          console.warn(formattedMessage);
          break;
        case 'INFO':
          console.info(formattedMessage);
          break;
        case 'DEBUG':
        default:
          console.log(formattedMessage);
          break;
      }
    }
  }
  
  // Convenience methods
  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }
  
  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }
  
  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }
  
  debug(message, meta = {}) {
    this.log('DEBUG', message, meta);
  }
  
  // Special method for database queries (common use case)
  query(sql, params = [], executionTime = null) {
    if (this.levels.DEBUG <= this.currentLevel) {
      const meta = { 
        sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : ''), 
        params: params.length > 0 ? params : undefined,
        executionTime: executionTime ? `${executionTime}ms` : undefined
      };
      this.debug('Database query executed', meta);
    }
  }
  
  // Special method for API requests
  request(method, path, statusCode = null, executionTime = null) {
    const meta = {
      method,
      path,
      statusCode,
      executionTime: executionTime ? `${executionTime}ms` : undefined
    };
    
    if (statusCode >= 500) {
      this.error('API request failed', meta);
    } else if (statusCode >= 400) {
      this.warn('API request error', meta);
    } else {
      this.info('API request processed', meta);
    }
  }
}

// Create singleton instance
const logger = new Logger();

export default logger;
