/**
 * 검색 관련성 기각(rejection) 게이트 팩토리.
 * mementoConfig.searchRejectionGate 설정에 따라 게이트 어댑터를 생성하거나 null을 반환한다.
 * #1095
 */

import type { IRelevanceGatePort } from '../../ports/relevance-gate-port.js';
import { JevRelevanceGate } from './jev-relevance-gate.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { logger } from '../../../../shared/utils/logger.js';

export function createRelevanceGate(): IRelevanceGatePort | null {
  const gate = mementoConfig.searchRejectionGate;

  switch (gate) {
    case 'off':
      return null;

    case 'typesafe': {
      const apiKey = mementoConfig.typesafeApiKey;
      if (!apiKey || apiKey.trim() === '') {
        logger.warn(
          'SEARCH_REJECTION_GATE=typesafe 인데 TYPESAFE_API_KEY 가 없다. 게이트를 끈 채로 동작한다.',
        );
        return null;
      }

      const gateInstance = new JevRelevanceGate({
        apiKey,
        model: mementoConfig.typesafeModel,
        timeoutMs: mementoConfig.searchRejectionGateTimeoutMs,
        docChars: mementoConfig.searchRejectionGateDocChars,
      });

      logger.info('Relevance rejection gate enabled', {
        provider: 'typesafe',
        model: mementoConfig.typesafeModel,
        threshold: mementoConfig.searchRejectionGateThreshold,
        timeoutMs: mementoConfig.searchRejectionGateTimeoutMs,
      });

      return gateInstance;
    }

    case 'ollama':
      logger.warn(
        'SEARCH_REJECTION_GATE=ollama 는 아직 구현되지 않았다 (#1095). 게이트를 끈 채로 동작한다.',
      );
      return null;

    default:
      return null;
  }
}
