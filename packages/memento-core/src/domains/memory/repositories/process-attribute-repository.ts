import { ProcessAttributeRepositorySqlite } from '../../../infrastructure/database/repositories/process-attribute-repository-sqlite.impl.js';

/**
 * @deprecated Use IProcessAttributeRepository from ./process-attribute-repository.interface.js
 * and ProcessAttributeRepositorySqlite from ../../../infrastructure/database/repositories/process-attribute-repository-sqlite.impl.js instead.
 */
export const ProcessAttributeRepository = ProcessAttributeRepositorySqlite;
export type ProcessAttributeRepository = ProcessAttributeRepositorySqlite;

export * from './process-attribute-repository.interface.js';
