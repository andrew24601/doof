/**
 * VM Register Allocator for Doof
 * 
 * Handles allocation and management of VM registers for functions.
 * Register layout:
 * - R0: return value / 'this' (for methods)
 * - R1-RN: parameters (in declaration order) 
 * - RN+1-RM: locals (in declaration order)
 * - RM+1+: temporaries and parameter passing
 */

import { Type } from '../../types';

export interface VariableInfo {
  name: string;
  type?: Type;
}

export class StructuredRegisterAllocator {
  private parameterNames: string[] = [];
  private localNames: string[] = [];
  private variableRegisters: Map<string, number> = new Map();
  // Track allocated registers properly
  private allocatedRegisters: Set<number> = new Set();
  private nextTemporary: number = 0;
  private firstTemporary: number = 0;
  private isSetup: boolean = false;

  /**
   * Phase 1: Setup function parameters and locals in predictable order
   */
  setupFunction(parameters: VariableInfo[], locals: VariableInfo[], hasThis: boolean = false): void {
    this.reset();
    this.isSetup = true;

    let currentRegister = 1; // R0 is always reserved for return value

    // For instance methods, 'this' goes in R1, parameters start at R2
    if (hasThis) {
      this.variableRegisters.set('this', 1);
      this.allocatedRegisters.add(1);
      currentRegister = 2;
    }

    // Allocate parameters starting at current register
    for (const param of parameters) {
      this.parameterNames.push(param.name);
      this.variableRegisters.set(param.name, currentRegister);
      this.allocatedRegisters.add(currentRegister);
      currentRegister++;
    }

    // Allocate locals after parameters
    for (const local of locals) {
      this.localNames.push(local.name);
      this.variableRegisters.set(local.name, currentRegister);
      this.allocatedRegisters.add(currentRegister);
      currentRegister++;
    }

    // Temporaries start after all parameters and locals
    this.nextTemporary = currentRegister;
    this.firstTemporary = currentRegister;
  }

  /**
   * Get pre-allocated register for variable/parameter
   */
  getVariable(name: string): number | undefined {
    return this.variableRegisters.get(name);
  }

  /**
   * Allocate a single temporary register
   */
  allocateTemporary(): number {
    if (!this.isSetup) {
      throw new Error("Register allocator not set up - call setupFunction first");
    }

    // Scan from firstTemporary onwards to find the first free register
    let reg = this.firstTemporary;
    while (this.allocatedRegisters.has(reg)) {
      reg++;
    }

    // Mark as allocated
    this.allocatedRegisters.add(reg);
    
    // Update nextTemporary if we've gone beyond it
    if (reg >= this.nextTemporary) {
      this.nextTemporary = reg + 1;
    }
    
    return reg;
  }

  /**
   * Allocate a contiguous block of registers for parameter passing
   * This scans from firstTemporary onwards to find a contiguous free block
   */
  allocateContiguous(count: number): number {
    if (!this.isSetup) {
      throw new Error("Register allocator not set up - call setupFunction first");
    }

    if (count <= 0) {
      throw new Error("Cannot allocate zero or negative registers");
    }

    // Scan from firstTemporary onwards to find a contiguous block of free registers
    let startReg = this.firstTemporary;
    
    while (true) {
      // Check if we have count consecutive free registers starting at startReg
      let foundContiguous = true;
      for (let i = 0; i < count; i++) {
        if (this.allocatedRegisters.has(startReg + i)) {
          foundContiguous = false;
          startReg = startReg + i + 1; // Move past the allocated register
          break;
        }
      }
      
      if (foundContiguous) {
        // Mark the registers as allocated
        for (let i = 0; i < count; i++) {
          this.allocatedRegisters.add(startReg + i);
        }
        
        // Update nextTemporary if we've gone beyond it
        if (startReg + count > this.nextTemporary) {
          this.nextTemporary = startReg + count;
        }
        
        return startReg;
      }
    }
  }

  /**
   * Free a temporary register for reuse
   */
  freeTemporary(register: number): void {
    // Validate register is in temporary range
    if (register < this.firstTemporary) {
      throw new Error(`Cannot free register R${register}: not a temporary register (temporaries start at R${this.firstTemporary})`);
    }

    // Check if register was actually allocated
    if (!this.allocatedRegisters.has(register)) {
      throw new Error(`Cannot free register R${register}: not currently allocated`);
    }

    // Remove from allocated set
    this.allocatedRegisters.delete(register);
  }

  /**
   * Free a contiguous block of registers
   */
  freeContiguous(startReg: number, count: number): void {
    if (count <= 0) {
      return;
    }
    
    // Free each register individually
    for (let i = 0; i < count; i++) {
      const reg = startReg + i;
      if (reg < this.firstTemporary) {
        throw new Error(`Cannot free register R${reg}: not a temporary register (temporaries start at R${this.firstTemporary})`);
      }
      if (!this.allocatedRegisters.has(reg)) {
        throw new Error(`Cannot free register R${reg}: not currently allocated`);
      }
      this.allocatedRegisters.delete(reg);
    }
  }

  /**
   * Legacy compatibility methods
   */
  allocate(): number {
    return this.allocateTemporary();
  }

  free(register: number): void {
    this.freeTemporary(register);
  }

  allocateVariable(name: string): number {
    if (!this.isSetup) {
      throw new Error("Register allocator not set up - call setupFunction first");
    }

    const register = this.variableRegisters.get(name);
    if (register === undefined) {
      throw new Error(`Variable '${name}' not declared in function scope - use setupFunction to declare variables`);
    }

    return register;
  }

  /**
   * Introspection methods
   */
  getParameterCount(): number {
    return this.parameterNames.length;
  }

  getLocalCount(): number {
    return this.localNames.length;
  }

  getFirstTemporaryRegister(): number {
    return this.firstTemporary;
  }

  getTotalRegistersUsed(): number {
    return this.nextTemporary;
  }

  isAllocated(register: number): boolean {
    return this.allocatedRegisters.has(register);
  }

  getAllocatedRegisters(): number[] {
    return Array.from(this.allocatedRegisters).sort((a, b) => a - b);
  }

  getFreeTemporaries(): number[] {
    // Calculate free temporaries by scanning from firstTemporary to nextTemporary-1
    const freeRegs: number[] = [];
    for (let reg = this.firstTemporary; reg < this.nextTemporary; reg++) {
      if (!this.allocatedRegisters.has(reg)) {
        freeRegs.push(reg);
      }
    }
    return freeRegs.sort((a, b) => a - b);
  }

  reset(): void {
    this.parameterNames = [];
    this.localNames = [];
    this.variableRegisters.clear();
    this.allocatedRegisters.clear();
    this.nextTemporary = 0;
    this.firstTemporary = 0;
    this.isSetup = false;
  }

  /**
   * Debug method for testing and troubleshooting
   */
  getRegisterLayout(): string {
    const layout: string[] = [];
    layout.push('Register Layout:');
    
    layout.push('  R0: return value');
    
    if (this.variableRegisters.has('this')) {
      layout.push('  R1: this');
    }
    
    this.parameterNames.forEach((name) => {
      const reg = this.variableRegisters.get(name)!;
      layout.push(`  R${reg}: parameter '${name}'`);
    });
    
    this.localNames.forEach((name) => {
      const reg = this.variableRegisters.get(name)!;
      layout.push(`  R${reg}: local '${name}'`);
    });
    
    layout.push(`  R${this.nextTemporary}+: available for temporaries`);
    layout.push(`  Allocated: [${this.getAllocatedRegisters().join(', ')}]`);
    layout.push(`  Free temporaries: [${this.getFreeTemporaries().join(', ')}]`);
    
    return layout.join('\n');
  }
}
