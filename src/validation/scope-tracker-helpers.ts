import { ScopeTrackerEntry, SourceLocation, Type } from '../types';

export type ScopeTrackerKind = ScopeTrackerEntry['kind'];

function formatLocationFragment(location?: SourceLocation): string {
  if (!location || !location.start) {
    return '??';
  }
  const line = typeof location.start.line === 'number' ? location.start.line : '??';
  const column = typeof location.start.column === 'number' ? location.start.column : '??';
  return `${line}:${column}`;
}

export function makeScopeId(name: string, scopeName: string | undefined, location?: SourceLocation): string {
  const scopeSegment = scopeName && scopeName.length > 0 ? scopeName : 'global';
  const locationSegment = formatLocationFragment(location);
  return `${name}@${scopeSegment}#${locationSegment}`;
}

export function createScopeTrackerEntry(options: {
  name: string;
  kind: ScopeTrackerKind;
  scopeName: string | undefined;
  location?: SourceLocation;
  type?: Type;
  isConstant: boolean;
  declaringClass?: string;
}): ScopeTrackerEntry {
  const scopeId = makeScopeId(options.name, options.scopeName, options.location);
  return {
    scopeId,
    name: options.name,
    kind: options.kind,
    declarationScope: options.scopeName ?? 'global',
    declarationLocation: options.location,
    type: options.type,
    isConstant: options.isConstant,
    declaringClass: options.declaringClass
  };
}

export function registerScopeTrackerEntry(map: Map<string, ScopeTrackerEntry>, entry: ScopeTrackerEntry): void {
  map.set(entry.scopeId, entry);

  const existing = map.get(entry.name);
  if (!existing || existing.scopeId === entry.scopeId) {
    map.set(entry.name, entry);
  }
}
