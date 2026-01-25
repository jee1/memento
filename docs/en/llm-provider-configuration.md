# LLM Provider Configuration Guide

## Overview

Memento project's LLM Provider initialization is managed consistently through the `LLMClientInitializer` common module. This module supports three LLM providers (OpenAI, Gemini, Ollama) and provides automatic fallback mechanisms.

## Environment Variables

### Basic Configuration

You can set the following environment variables in your `.env` file:

```bash
# LLM Provider selection (optional)
# Options: 'openai', 'gemini', 'ollama', 'auto' (default: 'auto')
LLM_PROVIDER=auto

# OpenAI configuration (optional)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_LLM_MODEL=gpt-4o-mini  # Default: gpt-4o-mini

# Gemini configuration (optional)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash  # Default: gemini-1.5-flash

# Ollama configuration (optional)
OLLAMA_BASE_URL=http://localhost:11434  # Default: http://localhost:11434
OLLAMA_MODEL=llama3  # Default: llama3
```

### Environment Variable Priority

LLM Provider selection follows this priority order:

1. **`process.env['LLM_PROVIDER']`** (Highest priority)
   - Directly set runtime environment variable
   - Example: `export LLM_PROVIDER=openai`

2. **`mementoConfig.llmProvider`** (Second priority)
   - Value read from `.env` file
   - Or value set in code

3. **`'auto'`** (Final default)
   - Auto-selection mode when above values are not set

## LLMClientInitializer Usage

### Basic Usage

```typescript
import { LLMClientInitializer } from './src/shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from './src/shared/services/llm-client-initializer.js';

// Initialize LLM clients
const initializer = new LLMClientInitializer();
const result: LLMClientInitializationResult = await initializer.initialize();

// Check initialization result
if (result.preferredProvider) {
  console.log('Selected Provider:', result.preferredProvider);
  console.log('Initialized Providers:', result.initializedProviders);
  
  // Use OpenAI client
  if (result.openaiClient) {
    // OpenAI client usage logic
  }
  
  // Use Gemini client
  if (result.geminiClient) {
    // Gemini client usage logic
  }
} else {
  console.error('No available LLM Provider.');
  console.error('Warnings:', result.warnings);
}
```

### API Key Validation

You can check API key existence before initialization:

```typescript
const initializer = new LLMClientInitializer();
const apiKeys = initializer.validateApiKeys();

console.log('OpenAI API key exists:', apiKeys.openai);
console.log('Gemini API key exists:', apiKeys.gemini);
```

### Initialization Result Structure

`LLMClientInitializationResult` interface:

```typescript
interface LLMClientInitializationResult {
  /** Selected provider (null if no provider is available) */
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  
  /** OpenAI client instance (null if initialization failed) */
  openaiClient: OpenAI | null;
  
  /** Gemini client instance (null if initialization failed) */
  geminiClient: GoogleGenerativeAI | null;
  
  /** List of successfully initialized providers */
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  
  /** List of warning messages during initialization */
  warnings: string[];
}
```

## Provider Selection and Fallback Strategy

### LLM_PROVIDER='openai'

1. **Primary attempt**: OpenAI
   - Initialize OpenAI client if `OPENAI_API_KEY` exists
   - On success: `preferredProvider = 'openai'`

2. **Fallback**: Gemini
   - Auto-switch to Gemini if OpenAI initialization fails
   - If `GEMINI_API_KEY` exists: `preferredProvider = 'gemini'`
   - Warning logged: "OpenAI를 사용할 수 없어 Gemini로 fallback합니다."

3. **Both fail**: `preferredProvider = null`
   - Error log output

### LLM_PROVIDER='gemini'

1. **Primary attempt**: Gemini
   - Initialize Gemini client if `GEMINI_API_KEY` exists
   - On success: `preferredProvider = 'gemini'`

2. **Fallback**: OpenAI
   - Auto-switch to OpenAI if Gemini initialization fails
   - If `OPENAI_API_KEY` exists: `preferredProvider = 'openai'`
   - Warning logged: "Gemini를 사용할 수 없어 OpenAI로 fallback합니다."

3. **Both fail**: `preferredProvider = null`
   - Error log output

### LLM_PROVIDER='ollama'

1. **Primary attempt**: Ollama
   - Connection test to `OLLAMA_BASE_URL` (GET `/api/tags`, 5 second timeout)
   - On HTTP 200 response and JSON parsing success: `preferredProvider = 'ollama'`

2. **Fallback**: OpenAI → Gemini
   - Try OpenAI first if Ollama connection fails
   - Try Gemini if OpenAI also fails
   - Warning messages logged

3. **All fail**: `preferredProvider = null`
   - Error log output

### LLM_PROVIDER='auto' (Default)

Automatically select the first available provider:

1. **Priority 1**: OpenAI
   - Selected if `OPENAI_API_KEY` exists

2. **Priority 2**: Gemini
   - Selected if OpenAI is unavailable and `GEMINI_API_KEY` exists

3. **Priority 3**: Ollama
   - Ollama connection test if both OpenAI and Gemini are unavailable
   - Selected on success

4. **All fail**: `preferredProvider = null`

## Ollama Connection Test

Ollama requires connection testing as it's a local server:

- **Test endpoint**: `GET {OLLAMA_BASE_URL}/api/tags`
- **Timeout**: 5 seconds
- **Success condition**: HTTP 200 response and JSON parsing success
- **Failure conditions**:
  - HTTP non-200 response
  - Timeout (5 seconds)
  - Network errors (`ECONNREFUSED`, `ENOTFOUND`, etc.)

On failure, warning messages are logged and fallback is performed.

## Service Integration Examples

### TripleExtractionService

```typescript
import { TripleExtractionService } from './src/domains/relation/services/triple-extraction/triple-extraction-service.js';

// Service automatically uses LLMClientInitializer on creation
const service = new TripleExtractionService();

// Extract triples (uses automatically initialized provider)
const result = await service.extractTriples('observation text', {
  provider: 'auto'  // or 'openai', 'gemini', 'ollama'
});
```

### LLMBasedRelationExtractor

```typescript
import { LLMBasedRelationExtractor } from './src/domains/relation/services/llm-based-relation-extractor.js';

// Service automatically uses LLMClientInitializer on creation
const extractor = new LLMBasedRelationExtractor();

// Extract relations (uses automatically initialized provider)
const relations = await extractor.extractRelations(newMemory, existingMemories);
```

### TripleExtractor

```typescript
import { TripleExtractor } from './src/domains/relation/services/triple-extraction/triple-extractor.js';

// Service automatically uses LLMClientInitializer on creation
const extractor = new TripleExtractor();

// Extract triples (uses automatically initialized provider)
const result = await extractor.extract('text', {
  provider: 'auto'  // or 'openai', 'gemini', 'ollama'
});
```

## Logging

LLMClientInitializer outputs the following logs during initialization:

- **`logger.info()`**: On successful initialization
- **`logger.warn()`**: On fallback, missing API keys, etc.
- **`logger.error()`**: When all providers fail to initialize

Log metadata format:

```typescript
logger.warn('LLM initialization warning', { 
  warning: 'OPENAI_API_KEY is missing.',
  requestedProvider: 'openai',
  fallbackProvider: 'gemini'
});
```

## Troubleshooting

### All Providers Unavailable

**Symptom**: `preferredProvider` returns `null`

**Causes**:
- API keys not set
- Ollama server not running
- Network connection issues

**Solutions**:
1. Check API key settings in `.env` file
2. Verify Ollama server is running: `ollama serve`
3. Check detailed error messages in `result.warnings` array

### Ollama Connection Failure

**Symptom**: Ollama selected but connection fails

**Causes**:
- Ollama server not running
- Incorrect `OLLAMA_BASE_URL` setting
- Firewall or network issues

**Solutions**:
1. Verify Ollama server is running: `ollama serve`
2. Check `OLLAMA_BASE_URL` environment variable
3. Test access in browser: `http://localhost:11434/api/tags`

### Fallback Not Working as Expected

**Symptom**: Configured provider not used, different provider used instead

**Causes**:
- Environment variable priority issues
- API keys not set

**Solutions**:
1. Check `process.env['LLM_PROVIDER']` (highest priority)
2. Check `LLM_PROVIDER` in `.env` file
3. Verify API key existence with `validateApiKeys()`

## References

- [LLMClientInitializer Source Code](../../src/shared/services/llm-client-initializer.ts)
- [Integration Test Examples](../../src/domains/relation/services/__tests__/llm-provider-integration.spec.ts)
- [Embedding Service Configuration Guide](./embedding-configuration.md)
