import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '../config/i18n';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
