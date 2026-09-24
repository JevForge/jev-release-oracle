import type { JevProviderId } from '../schemas/enums.js';
import type { JevProvider, JevProviderOptions } from './types.js';
import { createCustomCompatibleProvider } from './custom-compatible.js';
import { createTypesafeNativeProvider } from './typesafe-native.js';
import { createVercelAiGatewayProvider } from './vercel-ai-gateway.js';

export interface CreateJevProviderInput extends JevProviderOptions {
  provider: JevProviderId;
}

/** Builds exactly one Jev provider. Never falls back to another provider. */
export function createJevProvider(input: CreateJevProviderInput): JevProvider {
  switch (input.provider) {
    case 'vercel-ai-gateway':
      return createVercelAiGatewayProvider(input);
    case 'typesafe-native':
      return createTypesafeNativeProvider(input);
    case 'custom-compatible':
      return createCustomCompatibleProvider(input);
    default: {
      const exhaustive: never = input.provider;
      throw new Error(`Unsupported jev_provider: ${String(exhaustive)}`);
    }
  }
}
