import { ALL_RELATION_TYPES, type RelationType } from '../../../../shared/types/relation.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { ParseResult } from './types.js';

export function extractJsonObjectFromLlmText(text: string): string | null {
    if (!text || typeof text !== 'string') {
      return null;
    }
    
    let jsonText = text.trim();
    
    // 마크다운 코드 블록 제거
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```.*$/s, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```.*$/s, '');
    }

    // 첫 번째 '{'부터 시작하는 JSON 객체 찾기
    const firstBrace = jsonText.indexOf('{');
    if (firstBrace === -1) {
      logger.warn('JSON 객체 시작 문자({)를 찾을 수 없습니다', {
        textLength: jsonText.length,
        textPreview: jsonText.substring(0, 200)
      });
      return null;
    }

    // 중괄호 매칭하여 JSON 객체 끝 찾기
    // 이 방법은 JSON 뒤에 추가 텍스트가 있어도 정확하게 JSON 객체만 추출할 수 있습니다
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEnd = -1;
    
    for (let i = firstBrace; i < jsonText.length; i++) {
      const char = jsonText[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // JSON 객체 끝 찾음
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }
    
    if (jsonEnd === -1) {
      // 중괄호가 닫히지 않음 - 경고 로그
      logger.warn('JSON 객체가 완전히 닫히지 않았습니다', {
        braceCount,
        textLength: jsonText.length,
        extractedPreview: jsonText.substring(firstBrace, Math.min(firstBrace + 200, jsonText.length))
      });
      // 그래도 시도해보기 (마지막 '}'까지 추출)
      const lastBrace = jsonText.lastIndexOf('}');
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        return jsonText.substring(firstBrace, lastBrace + 1);
      }
      return jsonText.substring(firstBrace);
    }
    
    // JSON 객체만 추출 (추가 텍스트 제거)
    const extracted = jsonText.substring(firstBrace, jsonEnd).trim();
    
    // 추출된 JSON이 유효한지 빠르게 확인
    // 이 검증은 JSON.parse()가 실패하지 않도록 보장합니다
    try {
      const _parsed = JSON.parse(extracted);
      // 파싱 성공 시 유효한 JSON 반환
      return extracted;
    } catch (error) {
      // 유효하지 않은 JSON인 경우, 에러 타입에 따라 처리
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isTrailingTextError = errorMsg.includes('Unexpected non-whitespace character after JSON');
      
      if (isTrailingTextError) {
        // JSON 뒤에 추가 텍스트가 있는 경우, 더 정확하게 추출 시도
        // 중괄호 매칭이 정확했지만, JSON.parse()가 여전히 추가 텍스트를 감지
        // 이는 JSON 내부에 문제가 있거나, 추출 범위가 정확하지 않을 수 있음
        // 점진적으로 JSON 끝을 조정하여 유효한 JSON 찾기
        let validJson = null;
        for (let i = extracted.length; i > 0; i--) {
          const testJson = extracted.substring(0, i).trim();
          if (testJson.endsWith('}')) {
            try {
              JSON.parse(testJson);
              validJson = testJson;
              logger.debug('JSON 점진적 추출 성공 (extractJSON 내부)', {
                originalLength: extracted.length,
                validLength: validJson.length,
                removedChars: extracted.length - validJson.length
              });
              break;
            } catch {
              // 계속 시도
            }
          }
        }
        
        if (validJson) {
          return validJson;
        }
      }
      
      // 유효한 JSON을 찾지 못한 경우, 로그를 남기고 추출된 JSON 반환
      // parseLLMResponse에서 추가 정리 시도
      logger.warn('추출된 JSON이 유효하지 않습니다', {
        error: errorMsg,
        extractedLength: extracted.length,
        extractedPreview: extracted.substring(0, 200),
        originalPreview: jsonText.substring(0, 300)
      });
      // 그래도 반환 (parseLLMResponse에서 추가 정리 시도)
      return extracted;
    }
  }

export function trimToValidJsonObject(content: string): string {
    let finalJson = content;
    const firstBraceFinal = finalJson.indexOf('{');
    const lastBraceFinal = finalJson.lastIndexOf('}');
    if (firstBraceFinal === -1 || lastBraceFinal === -1 || lastBraceFinal <= firstBraceFinal) {
      return finalJson;
    }
    finalJson = finalJson.substring(firstBraceFinal, lastBraceFinal + 1).trim();
    let validJson: string | null = null;
    for (let i = finalJson.length; i > 0; i--) {
      const testJson = finalJson.substring(0, i).trim();
      if (testJson.endsWith('}')) {
        try {
          JSON.parse(testJson);
          validJson = testJson;
          break;
        } catch {
          // 계속 시도
        }
      }
    }
    return validJson ?? finalJson;
  }

export function prepareOllamaRelationJsonContent(content: string): string {
    let cleaned = content;
    const extracted = extractJsonObjectFromLlmText(content);
    if (extracted) {
      cleaned = extracted;
    } else {
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = content.substring(firstBrace, lastBrace + 1).trim();
      }
    }
    return trimToValidJsonObject(cleaned);
  }

export function parseLlmRelationsResponse(responseText: string): ParseResult {
    try {
      // Given: LLM 응답 텍스트 (JSON 형식이어야 함)
      // When: JSON 추출 및 파싱 시도
      
      // JSON 추출 (마크다운 코드 블록 및 추가 텍스트 제거)
      let jsonText = extractJsonObjectFromLlmText(responseText);
      
      if (!jsonText) {
        // JSON 추출 실패 시 원본 텍스트에서 직접 시도
        logger.warn('JSON 추출 실패, 원본 텍스트에서 직접 파싱 시도', {
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200)
        });
        jsonText = responseText.trim();
      }

      // JSON 파싱 시도 (여러 방법)
      let parsed: { relations?: Array<{
        target_id: string;
        relation_type: string;
        confidence: number;
        reasoning?: string;
      }> };
      
      try {
        // 첫 번째 시도: extractJSON으로 추출한 JSON 파싱
        // extractJSON이 이미 유효한 JSON만 반환하도록 보장하지만, 
        // 일부 모델은 JSON 뒤에 추가 텍스트를 포함할 수 있으므로 추가 정리 필요
        // JSON.parse()가 실패할 수 있으므로, 먼저 정리된 JSON인지 확인
        let trimmedJson = jsonText.trim();
        
        // JSON 뒤에 추가 텍스트가 있을 수 있으므로, 첫 번째 '{'부터 마지막 '}'까지만 추출
        const firstBrace = trimmedJson.indexOf('{');
        const lastBrace = trimmedJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          trimmedJson = trimmedJson.substring(firstBrace, lastBrace + 1).trim();
        }
        
        parsed = JSON.parse(trimmedJson);
        logger.debug('JSON 파싱 성공 (첫 번째 시도)');
      } catch (parseError) {
        // 첫 번째 시도 실패 시, 더 공격적인 정리 시도
        const firstError = parseError instanceof Error ? parseError.message : String(parseError);
        
        // JSON 파싱 에러가 "Unexpected non-whitespace character after JSON"인 경우
        // JSON 뒤에 추가 텍스트가 있다는 의미이므로, extractJSON을 다시 사용하거나
        // 더 정확한 JSON 추출 시도
        const isTrailingTextError = firstError.includes('Unexpected non-whitespace character after JSON');
        
        logger.warn('JSON 파싱 실패, 추가 정리 후 재시도', {
          error: firstError,
          isTrailingTextError,
          jsonLength: jsonText.length,
          jsonPreview: jsonText.substring(0, 300),
          jsonFull: jsonText.length < 1000 ? jsonText : jsonText.substring(0, 500) + '...' + jsonText.substring(jsonText.length - 500)
        });
        
        // 추가 정리: 첫 번째 '{'부터 마지막 '}'까지 추출
        // extractJSON이 이미 이를 수행했지만, 다시 시도하여 더 정확하게 추출
        let cleanedJson = jsonText.trim();
        
        // extractJSON을 다시 호출하여 더 정확한 추출 시도
        if (isTrailingTextError) {
          // "Unexpected non-whitespace character after JSON" 에러는 JSON 뒤에 추가 텍스트가 있다는 의미
          // extractJSON이 이미 이를 처리했지만, 여전히 문제가 있을 수 있으므로 더 정확하게 추출
          const reExtracted = extractJsonObjectFromLlmText(responseText);
          if (reExtracted && reExtracted !== jsonText) {
            cleanedJson = reExtracted.trim();
            logger.debug('JSON 재추출 완료 (trailing text 제거)', {
              originalLength: jsonText.length,
              cleanedLength: cleanedJson.length
            });
          } else {
            // extractJSON이 실패한 경우, 수동으로 첫 번째 '{'부터 마지막 '}'까지 추출
            // 그리고 JSON.parse()가 성공할 때까지 끝 부분을 점진적으로 제거
            const firstBrace = cleanedJson.indexOf('{');
            const lastBrace = cleanedJson.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              // 먼저 첫 번째 '{'부터 마지막 '}'까지 추출
              cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1).trim();
              
              // JSON.parse()가 성공할 때까지 끝 부분을 점진적으로 제거
              const attemptJson = cleanedJson;
              let foundValidJson = false;
              
              for (let i = attemptJson.length; i > 0 && !foundValidJson; i--) {
                const testJson = attemptJson.substring(0, i);
                // 마지막 문자가 '}'인지 확인
                if (testJson.endsWith('}')) {
                  try {
                    JSON.parse(testJson);
                    cleanedJson = testJson;
                    foundValidJson = true;
                    logger.debug('JSON 점진적 추출 성공', {
                      originalLength: jsonText.length,
                      cleanedLength: cleanedJson.length,
                      removedChars: attemptJson.length - cleanedJson.length
                    });
                  } catch {
                    // 계속 시도
                  }
                }
              }
              
              if (!foundValidJson) {
                logger.debug('JSON 수동 정리 완료 (점진적 추출 실패)', {
                  originalLength: jsonText.length,
                  cleanedLength: cleanedJson.length,
                  cleanedPreview: cleanedJson.substring(0, 300)
                });
              }
            }
          }
        } else {
          // 다른 종류의 에러인 경우, 기본 정리 시도
          const firstBrace = cleanedJson.indexOf('{');
          const lastBrace = cleanedJson.lastIndexOf('}');
          
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
            logger.debug('JSON 정리 완료', {
              originalLength: jsonText.length,
              cleanedLength: cleanedJson.length,
              cleanedPreview: cleanedJson.substring(0, 300)
            });
          }
        }
        
        // 두 번째 시도: 정리된 JSON 파싱
        try {
          parsed = JSON.parse(cleanedJson);
          logger.debug('JSON 파싱 성공 (두 번째 시도)');
        } catch (secondError) {
          // 두 번째 시도도 실패 - 원본에서 직접 추출 시도
          logger.warn('정리된 JSON 파싱도 실패, 원본에서 직접 추출 시도', {
            secondError: secondError instanceof Error ? secondError.message : String(secondError),
            cleanedLength: cleanedJson.length,
            cleanedPreview: cleanedJson.substring(0, 300)
          });
          
          // 원본 텍스트에서 다시 추출
          const reExtracted = extractJsonObjectFromLlmText(responseText);
          if (reExtracted && reExtracted !== jsonText && reExtracted !== cleanedJson) {
            try {
              parsed = JSON.parse(reExtracted);
              logger.debug('JSON 파싱 성공 (재추출 시도)');
            } catch (thirdError) {
              // 최종 실패
              logger.error('JSON 파싱 최종 실패', {
                firstError,
                secondError: secondError instanceof Error ? secondError.message : String(secondError),
                thirdError: thirdError instanceof Error ? thirdError.message : String(thirdError),
                originalLength: responseText.length,
                originalPreview: responseText.substring(0, 500),
                extractedLength: reExtracted?.length || 0,
                extractedPreview: reExtracted?.substring(0, 500) || 'null'
              });
              
              return {
                success: false,
                relations: [],
                error: `JSON 파싱 실패: ${thirdError instanceof Error ? thirdError.message : String(thirdError)}`
              };
            }
          } else {
            // 최종 실패
            logger.error('JSON 파싱 최종 실패', {
              firstError,
              secondError: secondError instanceof Error ? secondError.message : String(secondError),
              originalLength: responseText.length,
              originalPreview: responseText.substring(0, 500),
              cleanedLength: cleanedJson.length,
              cleanedPreview: cleanedJson.substring(0, 500)
            });
            
            return {
              success: false,
              relations: [],
              error: `JSON 파싱 실패: ${secondError instanceof Error ? secondError.message : String(secondError)}`
            };
          }
        }
      }

      // 응답 구조 검증
      if (!parsed.relations || !Array.isArray(parsed.relations)) {
        return {
          success: false,
          relations: [],
          error: '응답 구조가 올바르지 않습니다: relations 배열이 없거나 배열이 아닙니다.'
        };
      }

      // 관계 유형 및 신뢰도 검증
      const validRelations = parsed.relations
        .filter(rel => {
          // 관계 유형 검증
          if (!ALL_RELATION_TYPES.includes(rel.relation_type as RelationType)) {
            return false;
          }

          // 신뢰도 범위 검증
          if (typeof rel.confidence !== 'number' || rel.confidence < 0 || rel.confidence > 1) {
            return false;
          }

          return true;
        })
        .map(rel => ({
          target_id: rel.target_id,
          relation_type: rel.relation_type as RelationType,
          confidence: Math.max(0, Math.min(1, rel.confidence)), // 0~1 범위로 클램핑
          reasoning: rel.reasoning
        }));

      return {
        success: true,
        relations: validRelations
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LLM 응답 파싱 실패', { 
        error: errorMessage,
        responseText: responseText.substring(0, 500) // 처음 500자만 로깅
      });
      return {
        success: false,
        relations: [],
        error: `JSON 파싱 실패: ${errorMessage}`
      };
    }
  }
