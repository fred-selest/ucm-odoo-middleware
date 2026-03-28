'use strict';

// Mock du logger avant tout import
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  on: jest.fn(),
}));

// Configuration globale pour les tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Mock console.error pour éviter le bruit dans les tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
