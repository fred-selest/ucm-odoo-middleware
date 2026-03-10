'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const config = require('./config');

const { combine, timestamp, errors, printf, colorize, json } = format;

const humanFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

const consoleTransport = new transports.Console({
  format: combine(
    colorize({ all: true }),
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    humanFormat,
  ),
});

const fileTransport = new transports.DailyRotateFile({
  dirname:      config.app.logDir,
  filename:     'middleware-%DATE%.log',
  datePattern:  'YYYY-MM-DD',
  maxFiles:     '14d',
  maxSize:      '20m',
  zippedArchive: true,
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json(),
  ),
});

const activeTransports = [];
if (['console', 'both'].includes(config.app.logOutput)) activeTransports.push(consoleTransport);
if (['file', 'both'].includes(config.app.logOutput))    activeTransports.push(fileTransport);
if (activeTransports.length === 0)                      activeTransports.push(consoleTransport);

const logger = createLogger({
  level:       config.app.logLevel,
  transports:  activeTransports,
  exitOnError: false,
});

module.exports = logger;
