import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler';

describe('Async/Await Support', () => {
    it('should transpile async function and await', () => {
        const code = `
            async function heavyCalc(val: int): int {
                return val * 2;
            }

            function main() {
                let f = async heavyCalc(10);
                let res = await f;
            }
        `;
        
        const result = transpile(code);
        
        if (result.errors.length > 0) {
            console.error(JSON.stringify(result.errors, null, 2));
        }
        expect(result.errors).toHaveLength(0);
        expect(result.source).toContain('doof_runtime::Task<int>');
        expect(result.source).toContain('doof_runtime::ThreadPool::instance().submit(task)');
        expect(result.source).toContain('doof_runtime::Future<int>');
        expect(result.source).toContain('->get()');
    });

    it('should validate isolation rules', () => {
        const code = `
            let globalVar = 10;
            
            async function notIsolated(): int {
                return globalVar; // Error: Accessing mutable global
            }
            
            function main() {
                let f = async notIsolated();
            }
        `;
        
        const result = transpile(code);
        const isolationError = result.errors.find(e => e.message.includes('Async functions cannot access global variables'));
        if (!isolationError) {
             console.error('Errors found:', JSON.stringify(result.errors, null, 2));
        }
        expect(isolationError).toBeDefined();
    });

    it('should validate immutability of arguments', () => {
        const code = `
            class Mutable {
                x: int = 0;
            }

            async function process(m: Mutable): int {
                return m.x;
            }

            function main() {
                let m = new Mutable();
                m.x = 10;
                let f = async process(m); // Error: Mutable argument
            }
        `;

        const result = transpile(code);
        const immutabilityError = result.errors.find(e => e.message.includes('Async function arguments must be immutable'));
        
        if (!immutabilityError) {
             console.error('Errors found:', JSON.stringify(result.errors, null, 2));
        }
        expect(immutabilityError).toBeDefined();
    });
});
