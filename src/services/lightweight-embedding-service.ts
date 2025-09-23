/**
 * 경량 하이브리드 임베딩 서비스
 * TF-IDF + 키워드 매칭 기반 벡터화
 * OpenAI가 없을 때 사용하는 fallback 솔루션
 */

export interface LightweightEmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface LightweightSimilarityResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
}

export class LightweightEmbeddingService {
  private readonly model = 'lightweight-hybrid';
  private readonly dimensions = 512; // 고정 차원
  private vocabulary: Map<string, number> = new Map();
  private documentFrequencies: Map<string, number> = new Map();
  private totalDocuments = 0;
  private readonly stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    '이', '그', '저', '의', '가', '을', '를', '에', '에서', '로', '으로', '와', '과', '도', '는', '은'
  ]);

  constructor() {
    console.log('✅ 경량 하이브리드 임베딩 서비스 초기화 완료');
  }

  /**
   * 텍스트를 경량 임베딩으로 변환
   */
  async generateEmbedding(text: string): Promise<LightweightEmbeddingResult | null> {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다');
    }

    try {
      // 1. 텍스트 전처리
      const processedText = this.preprocessText(text);
      
      // 2. TF-IDF 벡터 생성
      const tfidfVector = this.createTFIDFVector(processedText);
      
      // 3. 키워드 가중치 적용
      const weightedVector = this.applyKeywordWeights(tfidfVector, processedText);
      
      // 4. 벡터 정규화
      const normalizedVector = this.normalizeVector(weightedVector);
      
      // 5. 차원 맞추기 (패딩 또는 자르기)
      const finalVector = this.adjustDimensions(normalizedVector);

      return {
        embedding: finalVector,
        model: this.model,
        usage: {
          prompt_tokens: this.estimateTokens(text),
          total_tokens: this.estimateTokens(text),
        },
      };
    } catch (error) {
      console.error('❌ 경량 임베딩 생성 실패:', error);
      throw new Error(`경량 임베딩 생성 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 쿼리와 유사한 임베딩 검색
   */
  async searchSimilar(
    query: string,
    embeddings: Array<{ id: string; content: string; embedding: number[] }>,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<LightweightSimilarityResult[]> {
    // 쿼리 임베딩 생성
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }

    // 코사인 유사도 계산
    const similarities = embeddings.map(item => {
      const similarity = this.cosineSimilarity(queryEmbedding.embedding, item.embedding);
      return {
        id: item.id,
        content: item.content,
        similarity,
        score: similarity
      };
    });

    // 유사도 순으로 정렬하고 임계값 필터링
    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * 텍스트 전처리
   */
  private preprocessText(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ') // 특수문자 제거, 한글 유지
      .split(/\s+/)
      .filter(word => word.length > 1 && !this.stopWords.has(word))
      .filter(word => word.trim().length > 0);
  }

  /**
   * TF-IDF 벡터 생성
   */
  private createTFIDFVector(words: string[]): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const wordCounts = new Map<string, number>();
    
    // 단어 빈도 계산
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // TF-IDF 계산
    for (const [word, count] of wordCounts) {
      const tf = count / words.length; // Term Frequency
      const idf = this.calculateIDF(word); // Inverse Document Frequency
      const tfidf = tf * idf;
      
      // 해시 기반 인덱스 생성
      const index = this.hashToIndex(word);
      vector[index] += tfidf;
    }

    return vector;
  }

  /**
   * IDF 계산 (간단한 휴리스틱)
   */
  private calculateIDF(word: string): number {
    // 실제로는 문서 컬렉션에서 계산해야 하지만, 
    // 여기서는 단어 길이와 복잡성을 기반으로 휴리스틱 사용
    const wordLength = word.length;
    const hasNumbers = /\d/.test(word);
    const hasSpecialChars = /[^a-zA-Z가-힣]/.test(word);
    
    let idf = 1.0;
    
    // 긴 단어일수록 높은 IDF
    if (wordLength > 5) idf += 0.5;
    if (wordLength > 8) idf += 0.3;
    
    // 숫자가 포함된 단어는 낮은 IDF (일반적으로 덜 중요)
    if (hasNumbers) idf -= 0.2;
    
    // 특수문자가 포함된 단어는 높은 IDF (고유할 가능성)
    if (hasSpecialChars) idf += 0.3;
    
    return Math.max(0.1, idf);
  }

  /**
   * 키워드 가중치 적용
   */
  private applyKeywordWeights(vector: number[], words: string[]): number[] {
    const weightedVector = [...vector];
    
    // 중요한 키워드 패턴에 가중치 적용
    for (const word of words) {
      if (!word || word.trim().length === 0) continue; // undefined 및 빈 문자열 체크
      
      const index = this.hashToIndex(word);
      
      // 배열 범위 체크
      if (index < 0 || index >= weightedVector.length) continue;
      
      // 안전한 배열 접근을 위한 체크
      const currentValue = weightedVector[index];
      if (currentValue === undefined) continue;
      
      // 기술 용어 가중치
      if (this.isTechnicalTerm(word)) {
        weightedVector[index] = currentValue * 1.5;
      }
      
      // 고유명사 가중치 (대문자로 시작하는 단어)
      if (word.length > 2 && word[0] && word[0] === word[0].toUpperCase()) {
        weightedVector[index] = currentValue * 1.3;
      }
      
      // 반복되는 단어 가중치 감소
      const wordFrequency = words.filter(w => w === word).length;
      if (wordFrequency > 3) {
        weightedVector[index] = currentValue * 0.8;
      }
    }
    
    return weightedVector;
  }

  /**
   * 기술 용어 판별
   */
  private isTechnicalTerm(word: string): boolean {
    const technicalPatterns = [
      /^[a-z]+[A-Z]/, // camelCase
      /^[A-Z][a-z]+[A-Z]/, // PascalCase
      /^[a-z]+_[a-z]+/, // snake_case
      /^[a-z]+-[a-z]+/, // kebab-case
      /api|sdk|http|json|xml|sql|db|ui|ux|ai|ml|nlp/i, // 기술 용어
      /react|vue|angular|node|python|java|typescript/i, // 프레임워크/언어
    ];
    
    return technicalPatterns.some(pattern => pattern.test(word));
  }

  /**
   * 벡터 정규화
   */
  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    
    return vector.map(val => val / magnitude);
  }

  /**
   * 차원 조정
   */
  private adjustDimensions(vector: number[]): number[] {
    if (vector.length === this.dimensions) {
      return vector;
    } else if (vector.length < this.dimensions) {
      // 패딩
      return [...vector, ...new Array(this.dimensions - vector.length).fill(0)];
    } else {
      // 자르기
      return vector.slice(0, this.dimensions);
    }
  }

  /**
   * 해시 기반 인덱스 생성
   */
  private hashToIndex(word: string): number {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      const char = word.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32비트 정수로 변환
    }
    return Math.abs(hash) % this.dimensions;
  }

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 토큰 수 추정
   */
  private estimateTokens(text: string): number {
    // 간단한 추정: 1 토큰 ≈ 4 문자
    return Math.ceil(text.length / 4);
  }

  /**
   * 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return true; // 항상 사용 가능
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    return {
      model: this.model,
      dimensions: this.dimensions,
      maxTokens: 8191, // OpenAI와 동일한 제한
    };
  }
}
