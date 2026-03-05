/**
 * Path Traversal 방지 유틸리티
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * 파일 경로 검증 및 파일명 정제를 제공하여 Path Traversal 공격을 방지합니다.
 */

import { resolve, normalize, isAbsolute, join, dirname } from 'path';

/**
 * 기본 허용 디렉토리 목록
 * 환경 변수 ALLOWED_FILE_DIRS가 지정되지 않은 경우 사용
 */
const DEFAULT_ALLOWED_DIRS = ['data/', 'logs/', 'backup/'];

/**
 * 환경 변수에서 허용 디렉토리 목록을 가져옵니다.
 * 
 * @returns 허용 디렉토리 목록
 */
function getAllowedDirs(): string[] {
  const envValue = process.env.ALLOWED_FILE_DIRS;
  
  // 환경 변수가 지정되지 않았거나 비어있는 경우 기본값 사용
  if (!envValue || envValue.trim() === '') {
    return DEFAULT_ALLOWED_DIRS;
  }
  
  // 콤마로 구분된 디렉토리 목록 파싱
  const dirs = envValue
    .split(',')
    .map(dir => dir.trim())
    .filter(dir => dir.length > 0); // 빈 문자열 제거
  
  return dirs.length > 0 ? dirs : DEFAULT_ALLOWED_DIRS;
}

/**
 * 경로가 절대 경로인지 확인합니다.
 * 
 * @param path 확인할 경로
 * @returns 절대 경로 여부
 */
function isAbsolutePath(path: string): boolean {
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path); // Windows 드라이브 문자 포함
}

/**
 * Path Traversal 패턴이 포함되어 있는지 확인합니다.
 * 
 * @param path 확인할 경로
 * @returns Path Traversal 패턴 포함 여부
 */
function containsPathTraversal(path: string): boolean {
  // 상대 경로 패턴 차단: ../, ..\\, ./, .\\
  const traversalPatterns = [
    /\.\.\//g,      // ../
    /\.\.\\/g,      // ..\\
    /^\.\//,        // ./
    /^\.\\/,        // .\\
    /\/\.\.\//g,    // /../
    /\\\.\.\\/g,    // \..\\
    /\/\.\.\\/g,    // /..\\
    /\\\.\.\//g     // \../
  ];
  
  return traversalPatterns.some(pattern => pattern.test(path));
}

/**
 * 경로가 허용된 디렉토리 내에 있는지 확인합니다.
 * 
 * @param path 확인할 경로
 * @param allowedDirs 허용된 디렉토리 목록
 * @returns 허용된 디렉토리 내 경로 여부
 */
function isWithinAllowedDirs(path: string, allowedDirs: string[]): boolean {
  const normalizedPath = normalize(path);
  const cwd = process.cwd();
  
  for (const allowedDir of allowedDirs) {
    let allowedPath: string;
    
    if (isAbsolute(allowedDir)) {
      // 절대 경로는 그대로 사용
      allowedPath = normalize(allowedDir);
    } else {
      // 상대 경로는 process.cwd() 기준으로 해석
      allowedPath = normalize(join(cwd, allowedDir));
    }
    
    // 경로가 허용된 디렉토리 내에 있는지 확인
    // normalize를 사용하여 경로를 정규화한 후 비교
    const resolvedPath = isAbsolute(normalizedPath) 
      ? normalize(normalizedPath)
      : normalize(join(cwd, normalizedPath));
    
    // 경로가 허용된 디렉토리로 시작하는지 확인
    if (resolvedPath.startsWith(allowedPath) || resolvedPath === allowedPath) {
      return true;
    }
  }
  
  return false;
}

/**
 * 파일 경로가 안전한지 검증합니다.
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * @param path 검증할 파일 경로
 * @param allowedDir 허용된 디렉토리 (선택사항, 지정 시 해당 디렉토리 내 경로만 허용)
 * @returns 경로가 안전하면 true, 그렇지 않으면 false
 */
export function validateFilePath(path: string, allowedDir?: string): boolean {
  if (!path || typeof path !== 'string') {
    return false;
  }
  
  // Path Traversal 패턴 차단
  if (containsPathTraversal(path)) {
    return false;
  }
  
  // allowedDir이 지정된 경우 해당 디렉토리 내 경로만 허용
  if (allowedDir) {
    const allowedDirs = [allowedDir];
    if (!isWithinAllowedDirs(path, allowedDirs)) {
      return false;
    }
    return true;
  }
  
  // allowedDir이 지정되지 않은 경우
  const allowedDirs = getAllowedDirs();
  
  // 절대 경로는 기본적으로 차단 (환경 변수에 절대 경로가 포함되어 있으면 허용)
  if (isAbsolutePath(path)) {
    // 환경 변수에 절대 경로가 포함되어 있는지 확인
    // 기본 허용 디렉토리(data/, logs/, backup/)는 상대 경로이므로 절대 경로와 매칭되지 않음
    // 환경 변수에 절대 경로가 명시적으로 지정되어 있는 경우만 허용
    return isWithinAllowedDirs(path, allowedDirs);
  }
  
  // 상대 경로는 기본 허용 디렉토리 내에 있는지 확인
  return isWithinAllowedDirs(path, allowedDirs);
}

/**
 * 파일명에서 위험한 문자를 제거하고 안전한 파일명으로 정제합니다.
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * @param fileName 정제할 파일명
 * @returns 정제된 파일명
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') {
    return 'file';
  }
  
  // Path Traversal 패턴 제거
  let sanitized = fileName
    .replace(/\.\.\//g, '')      // ../
    .replace(/\.\.\\/g, '')      // ..\\
    .replace(/^\.\//, '')        // ./
    .replace(/^\.\\/, '')        // .\\
    .replace(/\/\.\.\//g, '/')   // /../
    .replace(/\\\.\.\\/g, '\\')  // \..\\
    .replace(/\/\.\.\\/g, '/')   // /..\\
    .replace(/\\\.\.\//g, '\\'); // \../
  
  // 경로 구분자 제거
  sanitized = sanitized.replace(/[\/\\]/g, '');
  
  // 허용된 문자만 남기기: 영문, 숫자, 점, 하이픈, 언더스코어
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');
  
  // 최대 파일명 길이 제한 (255자)
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  
  // 빈 문자열이거나 모든 문자가 제거된 경우 기본 파일명 반환
  if (sanitized.length === 0) {
    return 'file';
  }
  
  return sanitized;
}

