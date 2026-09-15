/**
 * Structured logging utility
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const currentLevel = process.env.LOG_LEVEL || "INFO";

const getLevelValue = (level) => LOG_LEVELS[level] || 0;

const shouldLog = (level) => {
  return getLevelValue(level) <= getLevelValue(currentLevel);
};

const formatLog = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    level,
    message,
    environment: process.env.NODE_ENV,
    ...meta,
  };
};

const logger = {
  error: (message, meta = {}) => {
    if (shouldLog("ERROR")) {
      console.error(JSON.stringify(formatLog("ERROR", message, meta)));
    }
  },
  warn: (message, meta = {}) => {
    if (shouldLog("WARN")) {
      console.warn(JSON.stringify(formatLog("WARN", message, meta)));
    }
  },
  info: (message, meta = {}) => {
    if (shouldLog("INFO")) {
      console.info(JSON.stringify(formatLog("INFO", message, meta)));
    }
  },
  debug: (message, meta = {}) => {
    if (shouldLog("DEBUG")) {
      console.debug(JSON.stringify(formatLog("DEBUG", message, meta)));
    }
  },
};

module.exports = { logger };
