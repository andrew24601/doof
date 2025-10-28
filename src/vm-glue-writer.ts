import { promises as fs } from 'fs';
import path from 'path';
import { generateVmGlueFromProgram, generateRegisterAllGlue, type VmGlueFile } from './codegen/vm-glue-generator';
import type { GlobalValidationContext, ValidationContext } from './types';

export interface VmGlueWriterOptions {
  outputDir: string;
}

export interface VmGlueWriterResult {
  generatedFiles: string[];
  externClassCount: number;
}

export async function writeVmGlueFiles(
  globalContext: GlobalValidationContext | undefined,
  options: VmGlueWriterOptions
): Promise<VmGlueWriterResult> {
  if (!globalContext || globalContext.files.size === 0) {
    throw new Error('Unable to build program context for VM glue generation');
  }

  const validationContexts = globalContext.validationContexts as Map<string, ValidationContext> | undefined;
  const glueFiles = new Map<string, VmGlueFile>();

  for (const [filePath, program] of globalContext.files) {
    const validationContext = validationContexts?.get(filePath);
    const files = generateVmGlueFromProgram(program, validationContext);
    for (const file of files) {
      if (!glueFiles.has(file.className)) {
        glueFiles.set(file.className, file);
      }
    }
  }

  if (glueFiles.size === 0) {
    return { generatedFiles: [], externClassCount: 0 };
  }

  const resolvedOutput = path.resolve(options.outputDir);
  await fs.mkdir(resolvedOutput, { recursive: true });

  const generatedFiles: string[] = [];

  for (const file of glueFiles.values()) {
    const headerPath = path.join(resolvedOutput, file.headerFileName);
    const sourcePath = path.join(resolvedOutput, file.sourceFileName);
    await fs.writeFile(headerPath, file.headerContent);
    await fs.writeFile(sourcePath, file.sourceContent);
    generatedFiles.push(headerPath, sourcePath);
  }

  const registerAll = generateRegisterAllGlue(Array.from(glueFiles.keys()));
  if (registerAll) {
    const registerHeaderPath = path.join(resolvedOutput, registerAll.headerFileName);
    const registerSourcePath = path.join(resolvedOutput, registerAll.sourceFileName);
    await fs.writeFile(registerHeaderPath, registerAll.headerContent);
    await fs.writeFile(registerSourcePath, registerAll.sourceContent);
    generatedFiles.push(registerHeaderPath, registerSourcePath);
  }

  return {
    generatedFiles,
    externClassCount: glueFiles.size
  };
}
