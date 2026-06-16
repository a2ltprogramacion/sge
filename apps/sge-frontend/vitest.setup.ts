import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Web APIs
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, 'localStorage', {
  writable: true,
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

Object.defineProperty(window, 'indexedDB', {
  writable: true,
  value: {},
});

// Mock crypto for Web Crypto API
Object.defineProperty(global, 'crypto', {
  writable: true,
  value: {
    subtle: {
      digest: vi.fn(),
      sign: vi.fn(),
      verify: vi.fn(),
      generateKey: vi.fn(),
      importKey: vi.fn(),
      exportKey: vi.fn(),
      deriveKey: vi.fn(),
      deriveBits: vi.fn(),
    },
    getRandomValues: vi.fn(arr => arr),
    randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000000'),
  },
});