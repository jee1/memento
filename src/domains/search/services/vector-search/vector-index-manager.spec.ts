/**
 * 벡터 인덱스 매니저 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorIndexManager } from './vector-index-manager';
import type { VectorIndexRepository } from '../../../shared/interfaces/database.interface.js';
import type { VectorIndexStatus } from '../../../shared/types/vector-search.types.js';

// Mock 리포지토리 생성
const createMockIndexRepository = (): any => ({
  getIndexStatus: vi.fn(),
  rebuildIndex: vi.fn(),
  checkAvailability: vi.fn()
});

describe('VectorIndexManager', () => {
  let manager: VectorIndexManager;
  let mockRepository: any;

  beforeEach(() => {
    mockRepository = createMockIndexRepository();
    manager = new VectorIndexManager(mockRepository);
  });

  describe('getIndexStatus', () => {
    it('should return index status successfully', () => {
      // Given
      const expectedStatus: VectorIndexStatus = {
        available: true,
        tableExists: true,
        recordCount: 100,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      mockRepository.getIndexStatus.mockReturnValue(expectedStatus);

      // When
      const status = manager.getIndexStatus();

      // Then
      expect(status).toEqual(expectedStatus);
      expect(mockRepository.getIndexStatus).toHaveBeenCalled();
    });

    it('should handle repository errors gracefully', () => {
      // Given
      mockRepository.getIndexStatus.mockImplementation(() => {
        throw new Error('Database error');
      });

      // When
      const status = manager.getIndexStatus();

      // Then
      expect(status).toEqual({
        available: false,
        tableExists: false,
        recordCount: 0,
        dimensions: 384,
        vecExtensionLoaded: false
      });
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild index successfully', async () => {
      // Given
      mockRepository.rebuildIndex.mockResolvedValue(true);

      // When
      const result = await manager.rebuildIndex();

      // Then
      expect(result).toBe(true);
      expect(mockRepository.rebuildIndex).toHaveBeenCalled();
    });

    it('should handle rebuild errors gracefully', async () => {
      // Given
      mockRepository.rebuildIndex.mockRejectedValue(new Error('Rebuild failed'));

      // When
      const result = await manager.rebuildIndex();

      // Then
      expect(result).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should return availability status', () => {
      // Given
      mockRepository.checkAvailability.mockReturnValue(true);

      // When
      const available = manager.isAvailable();

      // Then
      expect(available).toBe(true);
      expect(mockRepository.checkAvailability).toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      // Given
      mockRepository.checkAvailability.mockImplementation(() => {
        throw new Error('Check failed');
      });

      // When
      const available = manager.isAvailable();

      // Then
      expect(available).toBe(false);
    });
  });

  describe('getStatusSummary', () => {
    it('should generate status summary', () => {
      // Given
      const status: VectorIndexStatus = {
        available: true,
        tableExists: true,
        recordCount: 50,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      mockRepository.getIndexStatus.mockReturnValue(status);

      // When
      const summary = manager.getStatusSummary();

      // Then
      expect(summary).toContain('사용가능');
      expect(summary).toContain('존재');
      expect(summary).toContain('50개');
      expect(summary).toContain('384');
    });
  });
});
