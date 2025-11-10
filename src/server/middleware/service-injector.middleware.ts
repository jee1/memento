/**
 * 서비스 주입 미들웨어
 * Express 요청 객체에 서버 서비스를 주입
 * Phase 0: 공통 모듈 설계
 */

import type { Request, Response, NextFunction } from 'express';
import type { ServerServices } from '../bootstrap.js';
import type Database from 'better-sqlite3';

/**
 * Express Request에 서버 컨텍스트 타입 확장
 */
declare global {
  namespace Express {
    interface Request {
      /** 서버 서비스 집합 */
      services?: ServerServices;
      /** 데이터베이스 인스턴스 */
      db?: Database.Database;
    }
  }
}

/**
 * 서비스 주입 미들웨어 생성 함수
 * 
 * @param services 서버 서비스 집합
 * @param db 데이터베이스 인스턴스
 * @returns Express 미들웨어 함수
 */
export function createServiceInjector(
  services: ServerServices,
  db: Database.Database
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.services = services;
    req.db = db;
    next();
  };
}

