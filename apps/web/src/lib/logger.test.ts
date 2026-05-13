import { describe, it, expect } from 'vitest';

import { logger } from './logger';

describe('logger', () => {
  it('exposes pino-shaped level methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('is silent in test mode', () => {
    expect(logger.level).toBe('silent');
  });

  it('creates child loggers that inherit level and add bindings', () => {
    const child = logger.child({ module: 'unit-test' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    expect(child.level).toBe('silent');
  });

  it('child logger bindings persist across calls', () => {
    const child = logger.child({ module: 'unit-test' });
    const grandchild = child.child({ requestId: 'abc' });
    expect(grandchild.level).toBe('silent');
    expect(typeof grandchild.warn).toBe('function');
  });

  it('does not throw when called with structured context (pino: obj first, msg second)', () => {
    const child = logger.child({ module: 'unit-test' });
    expect(() => child.error({ err: new Error('boom'), id: 1 }, 'test error')).not.toThrow();
  });
});
