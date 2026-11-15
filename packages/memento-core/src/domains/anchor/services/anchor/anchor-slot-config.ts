import { LOCAL_EMBEDDING_MODEL } from '../../../../shared/config/embedding-models.js';
import type { AnchorSlot } from './anchor-interfaces.js';

const { anchorSlots } = LOCAL_EMBEDDING_MODEL.memorySimilarity;

/** 슬롯별 n-hop 한도와 벡터 임계값. 임계값은 로컬 임베딩 모델의 기억끼리 기준값이다 (#1729). */
export const ANCHOR_SLOT_CONFIG: Readonly<
  Record<AnchorSlot, { readonly hop_limit: number; readonly vector_threshold: number }>
> = {
  A: { hop_limit: 1, vector_threshold: anchorSlots.A },
  B: { hop_limit: 2, vector_threshold: anchorSlots.B },
  C: { hop_limit: 3, vector_threshold: anchorSlots.C },
};
