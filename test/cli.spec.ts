import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import path from 'path';

// We need to mock the CLI module since it has side effects
vi.mock('fs');
vi.mock('../src/transpiler.js');

describe('CLI', () => {
  let mockConsoleLog: any;
  let mockConsoleError: any;
  let mockConsoleWarn: any;
  let mockProcessExit: any;
  let mockProcessArgv: string[];

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockProcessArgv = process.argv;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = mockProcessArgv;
  });

  describe('parseArgs', () => {
    it('should parse help flags', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['-h'])).toEqual({ help: true });
      expect(parseArgs(['--help'])).toEqual({ help: true });
    });

    it('should parse version flags', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['-v'])).toEqual({ version: true });
      expect(parseArgs(['--version'])).toEqual({ version: true });
    });

    it('should parse output option', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['-o', './build'])).toEqual({ output: './build' });
      expect(parseArgs(['--output', './dist'])).toEqual({ output: './dist' });
    });

    it('should parse namespace option', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['-n', 'myapp'])).toEqual({ namespace: 'myapp' });
      expect(parseArgs(['--namespace', 'test'])).toEqual({ namespace: 'test' });
    });

    it('should parse boolean flags', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['--header-only'])).toEqual({ headerOnly: true });
      expect(parseArgs(['--source-only'])).toEqual({ sourceOnly: true });
      expect(parseArgs(['--no-validation'])).toEqual({ noValidation: true });
    });

    it('should parse vm glue options', async () => {
      const { parseArgs } = await import('../src/cli.js');

      expect(parseArgs(['--vm-glue'])).toEqual({ vmGlue: true });
      expect(parseArgs(['--vm-glue-dir', './glue'])).toEqual({ vmGlueDir: './glue' });
    });

    it('should parse line directive disable flag', async () => {
      const { parseArgs } = await import('../src/cli.js');
      expect(parseArgs(['--no-line-directives'])).toEqual({ noLineDirectives: true });
      expect(parseArgs(['--no-lines'])).toEqual({ noLineDirectives: true });
    });

    it('should parse input file', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(parseArgs(['input.do'])).toEqual({ inputs: ['input.do'] });
      expect(parseArgs(['-o', './build', 'test.do'])).toEqual({ 
        output: './build', 
        inputs: ['test.do']  
      });
    });

    it('should throw on unknown flags', async () => {
      const { parseArgs } = await import('../src/cli.js');
      
      expect(() => parseArgs(['--unknown-flag', 'input.do'])).toThrow('Unknown option: --unknown-flag');
    });
  });

  describe('showHelp', () => {
    it('should display help message', async () => {
      const { showHelp } = await import('../src/cli.js');
      
      showHelp();
      
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('doof - TypeScript-like to C++ transpiler'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Options:'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Examples:'));
    });
  });

  describe('showVersion', () => {
    it('should display version', async () => {
      const { showVersion } = await import('../src/cli.js');
      
      showVersion();
      
      // Version string should start with 'doof ' followed by a semver-like pattern
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/^doof \d+\.\d+\.\d+/));
    });
  });
});
