import { describe, test, expect, beforeEach } from 'vitest';
import { StructuredRegisterAllocator } from '../src/codegen/vm/register-allocator';

describe('StructuredRegisterAllocator', () => {
  let allocator: StructuredRegisterAllocator;

  beforeEach(() => {
    allocator = new StructuredRegisterAllocator();
  });

  describe('setupFunction', () => {
    test('should set up function with no parameters or locals', () => {
      allocator.setupFunction([], [], false);
      
      expect(allocator.getParameterCount()).toBe(0);
      expect(allocator.getLocalCount()).toBe(0);
      expect(allocator.getFirstTemporaryRegister()).toBe(1); // R0 reserved for return
      expect(allocator.getTotalRegistersUsed()).toBe(1);
    });

    test('should set up function with parameters only', () => {
      const params = [
        { name: 'a', type: { kind: 'primitive', type: 'int' } as any },
        { name: 'b', type: { kind: 'primitive', type: 'string' } as any }
      ];
      
      allocator.setupFunction(params, [], false);
      
      expect(allocator.getParameterCount()).toBe(2);
      expect(allocator.getLocalCount()).toBe(0);
      expect(allocator.getVariable('a')).toBe(1); // R1
      expect(allocator.getVariable('b')).toBe(2); // R2
      expect(allocator.getFirstTemporaryRegister()).toBe(3);
      expect(allocator.getTotalRegistersUsed()).toBe(3);
    });

    test('should set up function with locals only', () => {
      const locals = [
        { name: 'x', type: { kind: 'primitive', type: 'int' } as any },
        { name: 'y', type: { kind: 'primitive', type: 'int' } as any }
      ];
      
      allocator.setupFunction([], locals, false);
      
      expect(allocator.getParameterCount()).toBe(0);
      expect(allocator.getLocalCount()).toBe(2);
      expect(allocator.getVariable('x')).toBe(1); // R1
      expect(allocator.getVariable('y')).toBe(2); // R2
      expect(allocator.getFirstTemporaryRegister()).toBe(3);
    });

    test('should set up function with both parameters and locals', () => {
      const params = [{ name: 'a' }, { name: 'b' }];
      const locals = [{ name: 'x' }, { name: 'y' }];
      
      allocator.setupFunction(params, locals, false);
      
      expect(allocator.getVariable('a')).toBe(1); // R1
      expect(allocator.getVariable('b')).toBe(2); // R2
      expect(allocator.getVariable('x')).toBe(3); // R3
      expect(allocator.getVariable('y')).toBe(4); // R4
      expect(allocator.getFirstTemporaryRegister()).toBe(5);
    });

    test('should handle "this" parameter for methods', () => {
      const params = [{ name: 'a' }];
      
      allocator.setupFunction(params, [], true);
      
      expect(allocator.getVariable('this')).toBe(1); // R1
      expect(allocator.getVariable('a')).toBe(2); // R2
      expect(allocator.getFirstTemporaryRegister()).toBe(3);
    });
  });

  describe('allocateTemporary', () => {
    beforeEach(() => {
      // Set up a basic function
      allocator.setupFunction([{ name: 'a' }], [{ name: 'x' }], false);
      // Function layout: R0=return, R1=a, R2=x, R3+=temporaries
    });

    test('should allocate new temporary registers sequentially', () => {
      const reg1 = allocator.allocateTemporary();
      const reg2 = allocator.allocateTemporary();
      const reg3 = allocator.allocateTemporary();
      
      expect(reg1).toBe(3);
      expect(reg2).toBe(4);
      expect(reg3).toBe(5);
      expect(allocator.getTotalRegistersUsed()).toBe(6);
    });

    test('should track allocated registers', () => {
      const reg1 = allocator.allocateTemporary();
      const reg2 = allocator.allocateTemporary();
      
      expect(allocator.isAllocated(reg1)).toBe(true);
      expect(allocator.isAllocated(reg2)).toBe(true);
      expect(allocator.getAllocatedRegisters()).toContain(reg1);
      expect(allocator.getAllocatedRegisters()).toContain(reg2);
    });

    test('should reuse freed registers', () => {
      const reg1 = allocator.allocateTemporary();
      const reg2 = allocator.allocateTemporary();
      
      allocator.freeTemporary(reg1);
      
      const reg3 = allocator.allocateTemporary();
      
      expect(reg3).toBe(reg1); // Should reuse the freed register
      expect(allocator.isAllocated(reg1)).toBe(true); // Should be allocated again
      expect(allocator.isAllocated(reg2)).toBe(true);
    });

    test('should throw error if not set up', () => {
      const unsetupAllocator = new StructuredRegisterAllocator();
      
      expect(() => unsetupAllocator.allocateTemporary()).toThrow(
        'Register allocator not set up - call setupFunction first'
      );
    });
  });

  describe('allocateContiguous', () => {
    beforeEach(() => {
      allocator.setupFunction([{ name: 'a' }], [], false);
      // Function layout: R0=return, R1=a, R2+=temporaries
    });

    test('should allocate contiguous block of registers', () => {
      const startReg = allocator.allocateContiguous(3);
      
      expect(startReg).toBe(2);
      expect(allocator.isAllocated(2)).toBe(true);
      expect(allocator.isAllocated(3)).toBe(true);
      expect(allocator.isAllocated(4)).toBe(true);
      expect(allocator.getTotalRegistersUsed()).toBe(5);
    });

    test('should not reuse freed registers for contiguous allocation', () => {
      // Allocate and free some temporaries to populate the free list
      const temp1 = allocator.allocateTemporary();
      const temp2 = allocator.allocateTemporary();
      allocator.freeTemporary(temp1);
      
      // Contiguous allocation should not use the free list
      const startReg = allocator.allocateContiguous(2);
      
      expect(startReg).toBe(temp2 + 1); // Should be after the last allocated register
      expect(allocator.isAllocated(startReg)).toBe(true);
      expect(allocator.isAllocated(startReg + 1)).toBe(true);
    });

    test('should handle single register allocation', () => {
      const reg = allocator.allocateContiguous(1);
      
      expect(reg).toBe(2);
      expect(allocator.isAllocated(reg)).toBe(true);
    });

    test('should throw error for invalid count', () => {
      expect(() => allocator.allocateContiguous(0)).toThrow(
        'Cannot allocate zero or negative registers'
      );
      
      expect(() => allocator.allocateContiguous(-1)).toThrow(
        'Cannot allocate zero or negative registers'
      );
    });
  });

  describe('allocateVariable', () => {
    beforeEach(() => {
      allocator.setupFunction([{ name: 'param' }], [{ name: 'local' }], false);
    });

    test('should return declared registers for parameters and locals', () => {
      expect(allocator.allocateVariable('param')).toBe(1);
      expect(allocator.allocateVariable('local')).toBe(2);
    });

    test('should return same register on repeated allocation', () => {
      const first = allocator.allocateVariable('param');
      const second = allocator.allocateVariable('param');

      expect(first).toBe(second);
      expect(first).toBe(1);
    });

    test('should throw error for unknown variables', () => {
      expect(() => allocator.allocateVariable('unknown')).toThrow(
        "Variable 'unknown' not declared in function scope - use setupFunction to declare variables"
      );
    });

    test('should require setup before allocating variables', () => {
      const fresh = new StructuredRegisterAllocator();
      expect(() => fresh.allocateVariable('param')).toThrow(
        'Register allocator not set up - call setupFunction first'
      );
    });
  });

  describe('freeTemporary', () => {
    beforeEach(() => {
      allocator.setupFunction([{ name: 'a' }], [], false);
    });

    test('should free allocated temporary registers', () => {
      const reg = allocator.allocateTemporary();
      
      expect(allocator.isAllocated(reg)).toBe(true);
      
      allocator.freeTemporary(reg);
      
      expect(allocator.isAllocated(reg)).toBe(false);
      expect(allocator.getFreeTemporaries()).toContain(reg);
    });

    test('should throw error for double free', () => {
      const reg = allocator.allocateTemporary();
      allocator.freeTemporary(reg);
      
      expect(() => allocator.freeTemporary(reg)).toThrow(
        `Cannot free register R${reg}: not currently allocated`
      );
    });

    test('should throw error for freeing non-temporary registers', () => {
      // Try to free a parameter register
      expect(() => allocator.freeTemporary(1)).toThrow(
        'Cannot free register R1: not a temporary register'
      );
      
      // Try to free return register
      expect(() => allocator.freeTemporary(0)).toThrow(
        'Cannot free register R0: not a temporary register'
      );
    });

    test('should throw error for freeing unallocated registers', () => {
      const firstTemp = allocator.getFirstTemporaryRegister();
      
      expect(() => allocator.freeTemporary(firstTemp + 10)).toThrow(
        `Cannot free register R${firstTemp + 10}: not currently allocated`
      );
    });
  });

  describe('freeContiguous', () => {
    beforeEach(() => {
      allocator.setupFunction([{ name: 'a' }], [], false);
    });

    test('should free contiguous block of registers', () => {
      const startReg = allocator.allocateContiguous(3);
      
      expect(allocator.isAllocated(startReg)).toBe(true);
      expect(allocator.isAllocated(startReg + 1)).toBe(true);
      expect(allocator.isAllocated(startReg + 2)).toBe(true);
      
      allocator.freeContiguous(startReg, 3);
      
      expect(allocator.isAllocated(startReg)).toBe(false);
      expect(allocator.isAllocated(startReg + 1)).toBe(false);
      expect(allocator.isAllocated(startReg + 2)).toBe(false);
    });
  });

  describe('parameter passing scenario', () => {
    test('should handle typical function call parameter allocation', () => {
      // Set up a function with some parameters and locals
      allocator.setupFunction(
        [{ name: 'a' }, { name: 'b' }], 
        [{ name: 'result' }], 
        false
      );
      // Layout: R0=return, R1=a, R2=b, R3=result, R4+=temps
      
      // Simulate generating a function call with 2 arguments
      const paramStartReg = allocator.allocateContiguous(2);
      expect(paramStartReg).toBe(4);
      
      // Simulate generating each argument expression
      const arg1TempReg = allocator.allocateTemporary();
      const arg2TempReg = allocator.allocateTemporary();
      expect(arg1TempReg).toBe(6);
      expect(arg2TempReg).toBe(7);
      
      // Arguments should be in contiguous registers R4 and R5
      expect(allocator.isAllocated(4)).toBe(true);
      expect(allocator.isAllocated(5)).toBe(true);
      
      // Free argument temporaries
      allocator.freeTemporary(arg1TempReg);
      allocator.freeTemporary(arg2TempReg);
      
      // Free parameter registers
      allocator.freeContiguous(paramStartReg, 2);
      
      // All temporary registers should be free
      expect(allocator.isAllocated(4)).toBe(false);
      expect(allocator.isAllocated(5)).toBe(false);
      expect(allocator.isAllocated(6)).toBe(false);
      expect(allocator.isAllocated(7)).toBe(false);
    });

    test('should handle complex expression with multiple temporary allocations', () => {
      allocator.setupFunction([{ name: 'str' }], [{ name: 'idx' }], false);
      // Layout: R0=return, R1=str, R2=idx, R3+=temps
      
      // Simulate the problematic expression: println("Index: " + idx)
      
      // 1. Allocate parameter register for println
      const printlnParamReg = allocator.allocateContiguous(1);
      expect(printlnParamReg).toBe(3);
      
      // 2. Generate binary expression "Index: " + idx into the parameter register
      //    This needs temporary registers for operands
      const leftOperandReg = allocator.allocateTemporary(); // for "Index: "
      const rightOperandReg = allocator.allocateTemporary(); // for type-converted idx
      expect(leftOperandReg).toBe(4);
      expect(rightOperandReg).toBe(5);
      
      // 3. All registers should be distinct
      expect(printlnParamReg).not.toBe(leftOperandReg);
      expect(printlnParamReg).not.toBe(rightOperandReg);
      expect(leftOperandReg).not.toBe(rightOperandReg);
      
      // 4. Clean up
      allocator.freeTemporary(leftOperandReg);
      allocator.freeTemporary(rightOperandReg);
      allocator.freeContiguous(printlnParamReg, 1);
      
      // All should be freed
      expect(allocator.isAllocated(3)).toBe(false);
      expect(allocator.isAllocated(4)).toBe(false);
      expect(allocator.isAllocated(5)).toBe(false);
    });
  });

  describe('reset', () => {
    test('should reset allocator to initial state', () => {
      allocator.setupFunction([{ name: 'a' }], [{ name: 'x' }], false);
      allocator.allocateTemporary();
      allocator.allocateContiguous(2);
      
      allocator.reset();
      
      expect(allocator.getParameterCount()).toBe(0);
      expect(allocator.getLocalCount()).toBe(0);
      expect(allocator.getTotalRegistersUsed()).toBe(0);
      expect(allocator.getAllocatedRegisters()).toHaveLength(0);
      expect(allocator.getFreeTemporaries()).toHaveLength(0);
    });
  });

  describe('getRegisterLayout', () => {
    test('should provide readable debug output', () => {
      allocator.setupFunction(
        [{ name: 'a' }, { name: 'b' }], 
        [{ name: 'x' }], 
        true
      );
      
      const layout = allocator.getRegisterLayout();
      
      expect(layout).toContain('R0: return value');
      expect(layout).toContain('R1: this');
      expect(layout).toContain('R2: parameter \'a\'');
      expect(layout).toContain('R3: parameter \'b\'');
      expect(layout).toContain('R4: local \'x\'');
      expect(layout).toContain('R5+: available for temporaries');
    });
  });

  describe('contiguous block reuse', () => {
    test('should reuse freed contiguous blocks when possible', () => {
      allocator.setupFunction([{ name: 'param1' }], [{ name: 'local1' }]);
      
      // Allocate and free a contiguous block
      const firstBlock = allocator.allocateContiguous(3);
      expect(firstBlock).toBe(3); // R3-R5
      allocator.freeContiguous(firstBlock, 3);
      
      // Allocate a smaller block - should reuse part of the freed block
      const secondBlock = allocator.allocateContiguous(2);
      expect(secondBlock).toBe(3); // Should reuse R3-R4
      
      // Allocate the remaining part
      const thirdBlock = allocator.allocateContiguous(1);
      expect(thirdBlock).toBe(5); // Should reuse R5
    });

    test('should merge adjacent freed contiguous blocks', () => {
      allocator.setupFunction([{ name: 'param1' }], [{ name: 'local1' }]);
      
      // Allocate multiple contiguous blocks
      const block1 = allocator.allocateContiguous(2); // R3-R4
      const block2 = allocator.allocateContiguous(2); // R5-R6
      const block3 = allocator.allocateContiguous(2); // R7-R8
      
      // Free blocks in order that should merge
      allocator.freeContiguous(block1, 2); // Free R3-R4
      allocator.freeContiguous(block2, 2); // Free R5-R6, should merge with R3-R4
      
      // Should now have one large block R3-R6
      const reusedBlock = allocator.allocateContiguous(4);
      expect(reusedBlock).toBe(3); // Should reuse the merged block R3-R6
    });

    test('should handle non-adjacent freed blocks separately', () => {
      allocator.setupFunction([{ name: 'param1' }], [{ name: 'local1' }]);
      
      // Allocate some non-adjacent blocks
      const block1 = allocator.allocateContiguous(2); // R3-R4
      const temp = allocator.allocateTemporary(); // R5
      const block2 = allocator.allocateContiguous(2); // R6-R7
      
      // Free the blocks but keep the temporary
      allocator.freeContiguous(block1, 2); // Free R3-R4
      allocator.freeContiguous(block2, 2); // Free R6-R7
      
      // Should be able to reuse either block
      const reused1 = allocator.allocateContiguous(2);
      expect(reused1).toBe(3); // Should reuse R3-R4
      
      const reused2 = allocator.allocateContiguous(2);
      expect(reused2).toBe(6); // Should reuse R6-R7
    });

    test('should prefer exact size matches when reusing blocks', () => {
      allocator.setupFunction([{ name: 'param1' }], [{ name: 'local1' }]);
      
      // Create blocks of different sizes
      const block1 = allocator.allocateContiguous(2); // R3-R4
      const block2 = allocator.allocateContiguous(4); // R5-R8
      
      allocator.freeContiguous(block1, 2); // Free R3-R4 (size 2)
      allocator.freeContiguous(block2, 4); // Free R5-R8 (size 4)
      
      // Request size 2 - should prefer the exact match over splitting the size 4 block
      const reused = allocator.allocateContiguous(2);
      expect(reused).toBe(3); // Should use the size 2 block at R3-R4
    });
  });
});
