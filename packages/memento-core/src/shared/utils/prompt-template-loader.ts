/**
 * 프롬프트 템플릿 로더 유틸리티
 * prompts/ 디렉토리에서 템플릿 파일을 읽고 플레이스홀더를 치환합니다.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeFileName } from './path-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 프로젝트 루트 디렉토리 경로
 * src/shared/utils/에서 prompts/로 가려면 ../../prompts/
 */
const PROJECT_ROOT = join(__dirname, '../../..');
const PROMPTS_DIR = join(PROJECT_ROOT, 'prompts');

/**
 * 템플릿 캐시 (메모리 캐시)
 */
const templateCache = new Map<string, string>();

/**
 * 프롬프트 템플릿 로더
 */
export class PromptTemplateLoader {
  /**
   * 템플릿 파일 로드
   * 
   * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
   * templateName 파라미터를 정제하여 Path Traversal 공격을 방지합니다.
   * 
   * @param templateName 템플릿 파일명 (예: 'triple-extraction')
   * @returns 템플릿 내용
   * @throws 파일이 없거나 읽을 수 없는 경우 에러 발생
   */
  static loadTemplate(templateName: string): string {
    // PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
    // templateName 정제 (사용자 입력일 수 있음)
    const sanitizedTemplateName = sanitizeFileName(templateName);
    
    // 캐시 확인 (정제된 이름 사용)
    if (templateCache.has(sanitizedTemplateName)) {
      return templateCache.get(sanitizedTemplateName)!;
    }

    // 파일 경로 구성 (정제된 이름 사용)
    const templatePath = join(PROMPTS_DIR, `${sanitizedTemplateName}.txt`);

    try {
      // 파일 읽기
      const content = readFileSync(templatePath, 'utf-8');
      
      // 캐시에 저장 (정제된 이름 사용)
      templateCache.set(sanitizedTemplateName, content);
      
      return content;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`프롬프트 템플릿 파일을 찾을 수 없습니다: ${templatePath}`);
      }
      throw new Error(`프롬프트 템플릿 파일 읽기 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 템플릿에 변수 치환
   * 
   * @param template 템플릿 문자열
   * @param variables 변수 객체 (예: { observation: '...' })
   * @returns 치환된 템플릿
   */
  static renderTemplate(template: string, variables: Record<string, string>): string {
    let rendered = template;

    // {variable} 형태의 플레이스홀더를 변수 값으로 치환
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      rendered = rendered.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return rendered;
  }

  /**
   * 템플릿 파일을 로드하고 변수 치환
   * 
   * @param templateName 템플릿 파일명
   * @param variables 변수 객체
   * @returns 치환된 프롬프트
   */
  static loadAndRender(templateName: string, variables: Record<string, string>): string {
    const template = this.loadTemplate(templateName);
    return this.renderTemplate(template, variables);
  }

  /**
   * 캐시 초기화 (테스트용)
   */
  static clearCache(): void {
    templateCache.clear();
  }

  /**
   * 템플릿 파일 경로 확인 (테스트용)
   * 
   * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
   * templateName 파라미터를 정제하여 Path Traversal 공격을 방지합니다.
   */
  static getTemplatePath(templateName: string): string {
    // PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
    const sanitizedTemplateName = sanitizeFileName(templateName);
    return join(PROMPTS_DIR, `${sanitizedTemplateName}.txt`);
  }
}

