import { describe, it, expect } from 'vitest';
import {
  MementoClient,
  MemoryManager,
  ContextInjector,
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError
} from './index.js';

describe('NPM Client Index', () => {
  describe('exports', () => {
    it('MementoClient를 내보내야 함', () => {
      expect(MementoClient).toBeDefined();
      expect(typeof MementoClient).toBe('function');
    });

    it('MemoryManager를 내보내야 함', () => {
      expect(MemoryManager).toBeDefined();
      expect(typeof MemoryManager).toBe('function');
    });

    it('ContextInjector를 내보내야 함', () => {
      expect(ContextInjector).toBeDefined();
      expect(typeof ContextInjector).toBe('function');
    });

    it('에러 클래스들을 내보내야 함', () => {
      expect(MementoError).toBeDefined();
      expect(ConnectionError).toBeDefined();
      expect(AuthenticationError).toBeDefined();
      expect(ValidationError).toBeDefined();
      expect(NotFoundError).toBeDefined();
    });
  });

  describe('MementoClient', () => {
    it('인스턴스를 생성할 수 있어야 함', () => {
      const client = new MementoClient();
      expect(client).toBeInstanceOf(MementoClient);
    });

    it('옵션과 함께 인스턴스를 생성할 수 있어야 함', () => {
      const options = {
        serverUrl: 'http://localhost:8080',
        apiKey: 'test-key'
      };
      const client = new MementoClient(options);
      expect(client).toBeInstanceOf(MementoClient);
    });
  });

  describe('MemoryManager', () => {
    it('MementoClient와 함께 인스턴스를 생성할 수 있어야 함', () => {
      const client = new MementoClient();
      const manager = new MemoryManager(client);
      expect(manager).toBeInstanceOf(MemoryManager);
    });
  });

  describe('ContextInjector', () => {
    it('MementoClient와 함께 인스턴스를 생성할 수 있어야 함', () => {
      const client = new MementoClient();
      const injector = new ContextInjector(client);
      expect(injector).toBeInstanceOf(ContextInjector);
    });
  });

  describe('Error Classes', () => {
    it('MementoError가 올바르게 작동해야 함', () => {
      const error = new MementoError('Test error', 'TEST_ERROR');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
    });

    it('ConnectionError가 올바르게 작동해야 함', () => {
      const error = new ConnectionError('Connection failed');
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR');
    });

    it('AuthenticationError가 올바르게 작동해야 함', () => {
      const error = new AuthenticationError('Invalid API key');
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid API key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('ValidationError가 올바르게 작동해야 함', () => {
      const error = new ValidationError('Invalid input');
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('NotFoundError가 올바르게 작동해야 함', () => {
      const error = new NotFoundError('Memory not found');
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Memory not found');
      expect(error.code).toBe('NOT_FOUND_ERROR');
    });
  });
});
