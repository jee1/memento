import { HYBRID_SEARCH } from '../../../shared/config/constants.js';
import type { IAdaptiveWeightCalculator, HybridWeights } from './hybrid-search-types.js';

export class AdaptiveWeightCalculator implements IAdaptiveWeightCalculator {
  private adaptiveWeights: Map<string, HybridWeights> = new Map();

  calculateWeights(query: string, vectorWeight: number, textWeight: number): HybridWeights {
    const queryKey = this.normalizeQuery(query);

    if (this.adaptiveWeights.has(queryKey)) {
      return this.adaptiveWeights.get(queryKey)!;
    }

    const queryAnalysis = this.analyzeQuery(query);
    let adjustedVectorWeight = vectorWeight;
    let adjustedTextWeight = textWeight;

    if (queryAnalysis.isTechnicalTerm) {
      adjustedVectorWeight = Math.min(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.max_weight,
        vectorWeight + HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.high_vector_boost
      );
      adjustedTextWeight = Math.max(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.min_weight,
        textWeight - HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.high_text_boost
      );
    } else if (queryAnalysis.isPhrase) {
      adjustedVectorWeight = Math.max(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.min_weight,
        vectorWeight - HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.high_vector_boost
      );
      adjustedTextWeight = Math.min(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.max_weight,
        textWeight + HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.high_text_boost
      );
    } else if (queryAnalysis.isShortQuery) {
      adjustedVectorWeight = Math.min(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.max_weight - 0.1,
        vectorWeight + HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.medium_boost
      );
      adjustedTextWeight = Math.max(
        HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.min_weight + 0.1,
        textWeight - HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.medium_boost
      );
    }

    const totalWeight = adjustedVectorWeight + adjustedTextWeight;
    const weights = {
      vectorWeight: adjustedVectorWeight / totalWeight,
      textWeight: adjustedTextWeight / totalWeight,
    };
    this.adaptiveWeights.set(queryKey, weights);

    return weights;
  }

  private analyzeQuery(query: string): {
    isTechnicalTerm: boolean;
    isPhrase: boolean;
    isShortQuery: boolean;
  } {
    const normalizedQuery = query.toLowerCase().trim();

    return {
      isTechnicalTerm: /^(api|sql|http|json|xml|css|html|js|ts|react|vue|angular|node|python|java|c\+\+|go|rust|docker|kubernetes|aws|azure|gcp)$/i.test(normalizedQuery),
      isPhrase: normalizedQuery.includes(' ') && normalizedQuery.split(' ').length >= 3,
      isShortQuery: normalizedQuery.length <= 10,
    };
  }

  private normalizeQuery(query: string): string {
    if (!query) {
      return '';
    }
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }
}
