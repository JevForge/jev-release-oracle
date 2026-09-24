import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFileConfig, resolveOracleConfig, validateOracleConfig } from '../../src/collectors/config.js';

describe('release oracle configuration', () => {
  it('loads .jev/config.yml and lets explicitly supplied inputs win', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-config-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(
      join(root, '.jev', 'config.yml'),
      [
        'environment: staging',
        'fetch_checks: false',
        'min_confidence: 0.9',
        'jev_provider: custom-compatible',
        'jev_endpoint: https://config.example/evaluate',
        'jev_model: config-model',
      ].join('\n'),
    );

    const fileConfig = loadFileConfig(root);
    const fromFile = resolveOracleConfig({}, fileConfig);
    expect(fromFile.environment).toBe('staging');
    expect(fromFile.fetchChecks).toBe(false);
    expect(fromFile.minConfidence).toBe(0.9);

    const overridden = resolveOracleConfig(
      { environment: 'production', fetch_checks: 'true', min_confidence: '0.8' },
      fileConfig,
    );
    expect(overridden.environment).toBe('production');
    expect(overridden.fetchChecks).toBe(true);
    expect(overridden.minConfidence).toBe(0.8);
    expect(overridden.jevEndpoint).toBe('https://config.example/evaluate');
  });

  it('rejects unknown config keys instead of silently ignoring them', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-invalid-config-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(join(root, '.jev', 'config.yml'), 'not_a_release_oracle_key: true\n');

    expect(() => loadFileConfig(root)).toThrow(/Invalid \.jev\/config\.yml/);
  });

  it('fails early for provider and compare configurations that cannot run', () => {
    expect(() =>
      validateOracleConfig(
        resolveOracleConfig({ jev_provider: 'custom-compatible', fetch_github_compare: 'true' }, {}),
      ),
    ).toThrow(/jev_endpoint.*jev_model|base_ref/);

    expect(() =>
      validateOracleConfig(
        resolveOracleConfig(
          {
            jev_provider: 'custom-compatible',
            jev_endpoint: 'https://jev.example/evaluate',
            jev_model: 'model',
            fetch_github_compare: 'true',
          },
          {},
        ),
      ),
    ).toThrow(/base_ref/);

    expect(() =>
      validateOracleConfig(
        resolveOracleConfig(
          {
            jev_provider: 'custom-compatible',
            jev_endpoint: 'https://jev.example/evaluate',
            jev_model: 'model',
            base_ref: 'v1.0.0',
          },
          {},
        ),
      ),
    ).not.toThrow();
  });

  it('rejects malformed scalar inputs and invalid runtime limits', () => {
    expect(() => resolveOracleConfig({ fetch_checks: 'sometimes' }, {})).toThrow(/Invalid boolean/);
    expect(() => resolveOracleConfig({ timeout_ms: 'not-a-number' }, {})).toThrow(/Invalid numeric/);
    expect(() => validateOracleConfig(resolveOracleConfig({ timeout_ms: '0' }, {}))).toThrow(/timeout_ms/);
    expect(() => validateOracleConfig(resolveOracleConfig({ max_items_to_jev: '201' }, {}))).toThrow(/max_items_to_jev/);
    expect(() =>
      validateOracleConfig(resolveOracleConfig({ jev_provider: 'typesafe-native' }, {})),
    ).toThrow(/typesafe-native/);
  });
});
