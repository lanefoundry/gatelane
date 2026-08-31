import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canonicalizeAuditPayload,
  hashPayload,
  signAuditEntry,
  verifyAuditEntry,
  createAndAppendAuditEntry,
  type AuditLogEntry,
  type AuditPayload,
} from '../src/audit.js';

const SIGNING_KEY = 'test-signing-key-must-be-≥16-chars';

describe('audit', () => {
  describe('canonicalizeAuditPayload', () => {
    it('produces deterministic JSON with sorted keys', () => {
      const payload: AuditPayload = {
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: { b: 2, a: 1 },
      };
      const result = canonicalizeAuditPayload(payload);
      expect(result).toContain('"a":1');
      expect(result).toContain('"b":2');
      expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
    });

    it('handles nested objects', () => {
      const payload: AuditPayload = {
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: { outer: { c: 3, a: 1, b: 2 } },
      };
      const result = canonicalizeAuditPayload(payload);
      expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
      expect(result.indexOf('"b"')).toBeLessThan(result.indexOf('"c"'));
    });
  });

  describe('hashPayload', () => {
    it('produces consistent SHA-256 hex hash', async () => {
      const payload = 'test payload';
      const hash1 = await hashPayload(payload);
      const hash2 = await hashPayload(payload);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // 32 bytes = 64 hex chars
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different payloads', async () => {
      const hash1 = await hashPayload('payload 1');
      const hash2 = await hashPayload('payload 2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('signAuditEntry / verifyAuditEntry', () => {
    it('signs and verifies an audit entry', async () => {
      const entry: AuditLogEntry = {
        id: 'entry-123',
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload_hash: 'abc123',
      };

      const signature = await signAuditEntry(entry, SIGNING_KEY);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const signedEntry = { ...entry, signature };
      const valid = await verifyAuditEntry(signedEntry, SIGNING_KEY);
      expect(valid).toBe(true);
    });

    it('rejects entry with wrong key', async () => {
      const entry: AuditLogEntry = {
        id: 'entry-123',
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload_hash: 'abc123',
      };

      const signature = await signAuditEntry(entry, SIGNING_KEY);
      const signedEntry = { ...entry, signature };

      const valid = await verifyAuditEntry(signedEntry, 'wrong-key-must-be-≥16-chars');
      expect(valid).toBe(false);
    });

    it('rejects entry with tampered payload_hash', async () => {
      const entry: AuditLogEntry = {
        id: 'entry-123',
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload_hash: 'abc123',
      };

      const signature = await signAuditEntry(entry, SIGNING_KEY);
      const signedEntry = { ...entry, signature, payload_hash: 'tampered' };

      const valid = await verifyAuditEntry(signedEntry, SIGNING_KEY);
      expect(valid).toBe(false);
    });

    it('rejects entry without signature', async () => {
      const entry: AuditLogEntry = {
        id: 'entry-123',
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload_hash: 'abc123',
      };

      const valid = await verifyAuditEntry(entry, SIGNING_KEY);
      expect(valid).toBe(false);
    });

    it('throws on key shorter than 16 chars', async () => {
      const entry: AuditLogEntry = {
        id: 'entry-123',
        gate_run_id: 'run-123',
        event_type: 'replay',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload_hash: 'abc123',
      };

      await expect(signAuditEntry(entry, 'short')).rejects.toThrow('signing key must be ≥ 16 chars');
    });
  });

  describe('createAndAppendAuditEntry', () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      }),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('creates and appends a signed audit entry', async () => {
      const entry = await createAndAppendAuditEntry(
        'run-123',
        'replay',
        { items: 5, candidates: ['model:a', 'model:b'] },
        SIGNING_KEY,
        mockDb as any
      );

      expect(entry.id).toBeDefined();
      expect(entry.gate_run_id).toBe('run-123');
      expect(entry.event_type).toBe('replay');
      expect(entry.timestamp).toBeDefined();
      expect(entry.payload_hash).toBeDefined();
      expect(entry.signature).toBeDefined();

      // Verify the entry was signed correctly
      const valid = await verifyAuditEntry(entry, SIGNING_KEY);
      expect(valid).toBe(true);

      // Verify DB was called
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log')
      );
    });

    it('uses correct event types', async () => {
      const eventTypes: AuditLogEntry['event_type'][] = [
        'capture', 'replay', 'judge', 'compare', 'promote', 'sign'
      ];

      for (const eventType of eventTypes) {
        const entry = await createAndAppendAuditEntry(
          'run-123',
          eventType,
          { data: 'test' },
          SIGNING_KEY,
          mockDb as any
        );
        expect(entry.event_type).toBe(eventType);
      }
    });
  });
});