/**
 * NPC State Alpha — Shared Runtime Exports
 *
 * Implements S2 Shared Runtime Foundation:
 * - Versioned State Schema (npc_state_alpha.v1)
 * - Deterministic Storage Adapter with CAS
 * - Commit-boundary Checkpoint Foundation
 * - Shared Source/Evidence Resolver
 * - Identity and Admission Primitives
 * - Shared Field & Domain Applier
 * - Exactly One Shared Commit Coordinator
 */

export * from '../state/schema.js';
export * from '../state/storage.js';
export * from '../state/checkpoints.js';
export * from './source-resolver.js';
export * from './identity.js';
export * from './field-applier.js';
export * from './relationship-mechanics.js';
export * from './commit-coordinator.js';
